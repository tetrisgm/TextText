// Real file-backed workflow acceptance. Local scratch accounts, tokens and
// TextPacks only; never uses legacy SQL posts/folders as content evidence.
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { actionAudit, apiTokens, blogs, users } from "@/lib/db/schema";
import { createApiToken } from "@/lib/api-tokens";
import { MCP_PROTOCOL_VERSION } from "@/lib/mcp/protocol";
import { decideWorkspaceWriteProposal } from "@/lib/ai/write-proposals.server";
import { openPack, encodePack } from "@/local-vault/pack";
import { readDocument, writePayload } from "@/local-vault/model";

const origin = process.env.TEXTTEXT_ORIGIN ?? "http://localhost:3000";
const root = process.env.TEXTTEXT_VAULT_ROOT;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object result");
  return value as Record<string, unknown>;
}
function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
  console.log(`PASS ${label}`);
}
async function main() {
  if (!db || !root || !path.isAbsolute(root)) throw new Error("Local database and isolated absolute vault root are required");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Workflow verification refuses production");
  const database = db, stamp = randomUUID(), handle = `file-workflow-${stamp}`;
  const sub = `workflow-owner-${stamp}`, guestSub = `workflow-guest-${stamp}`;
  const guestEmail = `guest-${stamp}@example.com`;
  let ownerId = "", guestId = "", workspaceId = "", token = "", guestToken = "";
  const key = () => randomUUID();
  async function call(name: string, args: Record<string, unknown>, required = true) {
    const response = await fetch(`${origin}/api/mcp`, { method: "POST", headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION, "Mcp-Method": "tools/call", "Mcp-Name": name,
    }, body: JSON.stringify({ jsonrpc: "2.0", id: key(), method: "tools/call", params: { name, arguments: args,
      _meta: { "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "file-workflow-eval", version: "1" } } } }) });
    const raw = await response.text();
    const text = raw.trim().startsWith("{") ? raw : raw.split("\n").find(line => line.startsWith("data:"))?.slice(5);
    const envelope = text ? object(JSON.parse(text)) : {};
    const result = envelope.result ? object(envelope.result) : {};
    const ok = response.ok && !envelope.error && !result.isError;
    if (required) check(ok, `${name} succeeds`);
    const content = Array.isArray(result.content) ? object(result.content[0]).text : "";
    let data: Record<string, unknown> = {};
    if (typeof content === "string") { try { data = object(JSON.parse(content)); } catch { /* Error text is never content evidence. */ } }
    return { ok, data };
  }
  async function api(route: string, method = "GET", body?: unknown, guest = false) {
    return fetch(`${origin}/api/vault/${workspaceId}${route}`, { method, headers: {
      Authorization: `Bearer ${guest ? guestToken : token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function item(id: string) { return object((await call("read_item", { id })).data.item); }
  async function approve(data: Record<string, unknown>) {
    check(typeof data.proposalId === "string", "hosted destructive or asset mutation is staged");
    const result = await decideWorkspaceWriteProposal({ actor: { sub, userId: ownerId, handle }, proposalId: data.proposalId, decision: "approve" });
    if (result.status !== "completed") throw new Error(`Owner approval failed: ${JSON.stringify(result)}`);
    check(true, "owner approval completes the file mutation");
  }
  try {
    const [owner] = await database.insert(users).values({ appleSub: sub, username: handle, name: "File workflow owner" }).returning(); ownerId = owner.id;
    const [guest] = await database.insert(users).values({ appleSub: guestSub, email: guestEmail, name: "File workflow guest" }).returning(); guestId = guest.id;
    const [workspace] = await database.insert(blogs).values({ handle, name: "File workflow scratch", ownerId }).returning(); workspaceId = workspace.id;
    token = (await createApiToken(ownerId, "Workflow native client", { kind: "app", scopes: "sync" })).raw;
    guestToken = (await createApiToken(guestId, "Workflow guest client", { kind: "app", scopes: "sync" })).raw;
    check(object((await call("get_workspace", {})).data.workspace).id === workspaceId, "owner reaches only its file workspace");
    for (const name of ["Notes", "Bookmarks", "Blog"]) {
      const args = { parent_path: "", name, idempotency_key: key() };
      await call("create_folder", args); await call("create_folder", args);
    }
    const creation = { title: "Shared note", body: "Original author text", folder_path: "Notes", idempotency_key: key() };
    const created = object((await call("create_item", creation)).data.item), id = String(created.id);
    check(object((await call("create_item", creation)).data.item).id === id, "creation retry preserves one identity");
    const privateItem = object((await call("create_item", { ...creation, title: "Private sibling", idempotency_key: key() })).data.item);
    const before = await item(id);
    await call("update_item", { id, body: "Saved author text", if_match_hash: before.hash, idempotency_key: key() });
    check(!(await call("update_item", { id, body: "Stale overwrite", if_match_hash: before.hash, idempotency_key: key() }, false)).ok, "stale writer cannot overwrite later text");
    check((await item(id)).body === "Saved author text", "stale refusal retains author text");

    // comments: persisted in the TextPack and read through real MCP requests.
    await call("add_comment", { id, body: "Review comment", idempotency_key: key() });
    const comments = (await call("list_comments", { id, state: "all" })).data.comments as Record<string, unknown>[];
    check(comments.length === 1, "comments are read from the actual file");
    await call("set_comment_resolved", { id, comment_id: comments[0].id, resolved: true, idempotency_key: key() });
    check(Boolean(((await call("list_comments", { id, state: "all" })).data.comments as Record<string, unknown>[])[0].resolvedAt), "comment resolution persists");

    // sharing_access: native app tokens exercise the owner's public UI routes.
    const scope = { scopeType: "item", scopeKey: id };
    const invite = await api("/shares", "POST", { ...scope, email: guestEmail, role: "viewer" });
    check(invite.ok, "owner can invite a file viewer");
    const grantId = object((object(await invite.json()).grants as unknown[])[0]).id;
    check((await api(`/items/${id}`, "GET", undefined, true)).ok, "fresh guest principal reads its shared file");
    check((await api(`/items/${privateItem.id}`, "GET", undefined, true)).status === 404, "guest cannot read a private sibling");
    check((await api("/shares", "POST", { ...scope, email: guestEmail, role: "editor" }, true)).status === 403, "guest cannot escalate its own role");
    const sharedResponse = await api(`/items/${id}`, "GET", undefined, true);
    const revision = sharedResponse.headers.get("etag")!.replace(/^"|"$/g, "");
    const sharedBytes = new Uint8Array(await sharedResponse.arrayBuffer());
    const sharedPack = openPack(sharedBytes, String((await item(id)).path), revision, id);
    const sharedDocument = readDocument(sharedPack.file); sharedDocument.content.body += "\nGuest editor text";
    const editBytes = encodePack(sharedPack, writePayload(sharedPack.file, sharedDocument));
    const writeGuest = (hash: string) => fetch(`${origin}/api/vault/${workspaceId}/items/${id}`, { method: "PUT", headers: {
      Authorization: `Bearer ${guestToken}`, "Content-Type": "application/zip", "If-Match": `"${hash}"`,
      "X-TextText-Path": encodeURIComponent(sharedPack.file.path), "X-TextText-Operation-Id": key(),
    }, body: new Uint8Array(editBytes) });
    check((await writeGuest(revision)).status === 403, "viewer cannot modify the shared file");
    check((await api("/shares", "PATCH", { ...scope, grantId, role: "editor" })).ok, "owner upgrades the file grant");
    check((await writeGuest(revision)).ok, "existing guest session can edit after owner upgrade");
    check((await item(id)).body === sharedDocument.content.body, "guest edit persisted in the owner file");
    check((await api("/shares", "DELETE", { ...scope, grantId })).ok, "owner revokes the grant");
    check((await api(`/items/${id}`, "GET", undefined, true)).status === 404, "same guest session loses read access immediately");
    check([403, 404].includes((await writeGuest(String((await item(id)).hash))).status), "revoked guest cannot write");

    // cover_assets: approval writes embedded asset bytes, not a SQL cover row.
    const current = await item(id);
    const cover = await call("add_item_asset", { id, source_url: process.env.TEXTTEXT_ASSET_FIXTURE_URL,
      placement: "cover", alt_text: "Fixture cover", if_match_hash: current.hash, idempotency_key: key() });
    await approve(cover.data);
    const covered = await item(id), coveredDocument = object(covered.document), coveredContent = object(coveredDocument.content);
    check(Boolean(object(coveredContent.fields).cover) && Array.isArray(coveredContent.assets) && coveredContent.assets.length === 1, "cover asset persists in the file snapshot");

    // folder_trash_restore now uses portable file identity, not SQL folder rows.
    const deletion = await call("delete_item", { id, path: covered.path, if_match_hash: covered.hash, idempotency_key: key() });
    await approve(deletion.data);
    const trash = (await call("list_trash", {})).data.items as Record<string, unknown>[];
    check(trash.some(entry => entry.id === id), "deleted file appears in durable Trash");
    const restoreArgs = { id, path: covered.path, if_match_hash: covered.hash, idempotency_key: key() };
    await call("restore_item", restoreArgs); await call("restore_item", restoreArgs);
    check((await item(id)).body === sharedDocument.content.body, "restore retry retains same identity and content");

    const bookmark = object((await call("create_item", { capture: "https://example.com/article", folder_path: "Bookmarks", idempotency_key: key() })).data.item);
    const bookmarkDocument = object((await item(String(bookmark.id))).document);
    check(object(object(bookmarkDocument.content).fields).sourceUrl === "https://example.com/article", "bookmark capture retains its original URL in the TextPack");
    check(!(await call("recapture_bookmark", { id: bookmark.id }, false)).ok, "removed legacy recapture command fails closed");
    // Actual file-reader extraction/recapture and Living brief workflows remain
    // product requirements; this check does not claim those legacy paths work.
    const audit = await database.select({ name: actionAudit.actionName }).from(actionAudit).where(inArray(actionAudit.actorUserId, [ownerId, guestId]));
    for (const name of ["vault.write", "vault.folder.create", "vault.comment.create", "vault.comment.resolve", "vault.share.role", "vault.share.revoke", "vault.delete", "vault.restore"]) {
      check(audit.some(row => row.name === name), `${name} leaves an attributed audit`);
    }
    console.log(JSON.stringify({ status: "pass", backend: "file", principals: 2, workflows: ["creation", "stale_write", "comments", "sharing_access", "cover_assets", "trash_restore"], incomplete: ["bookmark_recapture", "living_brief"] }));
  } finally {
    if (workspaceId) { await database.delete(blogs).where(eq(blogs.id, workspaceId)); await rm(path.join(root, workspaceId), { recursive: true, force: true }); }
    const ids = [ownerId, guestId].filter(Boolean);
    if (ids.length) { await database.delete(apiTokens).where(inArray(apiTokens.userId, ids)); await database.delete(actionAudit).where(inArray(actionAudit.actorUserId, ids)); await database.delete(users).where(inArray(users.id, ids)); }
    console.log("Scratch accounts and file workspace removed.");
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "File workflow verification failed"); process.exitCode = 1; });
