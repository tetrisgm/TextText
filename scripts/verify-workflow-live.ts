// Live end-to-end proof of the shared workspace workflows against a running
// TextText server,
// driven through the real command surface (/api/mcp) the app, the native
// assistant, and external agents all share.
//
// The staged-app health receipts (mac/scripts/verify-workflow-capabilities.sh)
// are content-blind: they attest the workflow contracts exist, but never mutate
// a real workspace. This supplements them with a REAL run: it stands up a fully
// isolated scratch workspace (throwaway user + blog + token), executes each
// required workflow over MCP, and asserts both the durable mutation and its
// action_audit row, then tears everything down in a finally.
//
//   npm run verify:workflows
//
// Covers the five required workflow IDs: folder_trash_restore, comments,
// cover_assets, sharing_access, bookmark_recapture. Plus two coverage add-ons
// for store paths that have no fast unit test (they need a DB): folder_rename
// (rename sanitization + CAS) and the access role lifecycle (set_access +
// revoke_access).

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  actionAudit,
  apiTokens,
  blogs,
  collaborators,
  folders,
  idempotencyKeys,
  itemComments,
  posts,
  users,
} from "@/lib/db/schema";
import { ensureWorkspaceFolders } from "@/lib/store";
import { generateApiToken, hashApiToken } from "@/lib/api-tokens";
import { MCP_PROTOCOL_VERSION } from "../src/lib/mcp/protocol";

const ORIGIN = process.env.TEXTTEXT_ORIGIN ?? "http://127.0.0.1:3000";
const ASSET_FIXTURE_URL =
  process.env.TEXTTEXT_ASSET_FIXTURE_URL ?? "https://TextText.app/opengraph-image";
const STAMP = Date.now().toString(36);
const SUB = `scratch-workflow-verify-${STAMP}`;
const HANDLE = `scratch-workflow-verify-${STAMP}`;

const pass: string[] = [];
const fail: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  (ok ? pass : fail).push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

/** Decode a Streamable-HTTP response body: direct JSON or an SSE `data:` line. */
function rpcPayload(body: string): unknown {
  const stripped = body.trim();
  if (stripped.startsWith("{")) return JSON.parse(stripped);
  for (const line of stripped.split("\n")) {
    if (line.startsWith("data:")) return JSON.parse(line.slice(5).trim());
  }
  throw new Error(`no JSON-RPC payload: ${body.slice(0, 200)}`);
}

async function main() {
  if (!db) throw new Error("DATABASE_URL required");
  const token = generateApiToken();
  const mcpHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  // MCP 2026-07-28 carries the protocol version, client capabilities, and
  // identity on every request instead of in an initialize handshake, and
  // mirrors the method and name into headers that the server checks against
  // the body.
  const requestMeta = {
    "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": {
      name: "verify-workflow-live",
      version: "1.0.0",
    },
  };
  let rpcId = 100;

  /** One MCP tools/call. Returns the parsed tool output (content[0].text as
   * JSON when present) plus whether the tool reported an error. */
  async function tool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; data: Record<string, unknown> | null; error: string }> {
    const res = await fetch(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: {
        ...mcpHeaders,
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: (rpcId += 1),
        params: { name, arguments: args, _meta: requestMeta },
      }),
    });
    const raw = await res.text();
    if (res.status !== 200) return { ok: false, data: null, error: `HTTP ${res.status}: ${raw.slice(0, 160)}` };
    const result = (rpcPayload(raw) as { result?: { content?: Array<{ text?: string }>; isError?: boolean } }).result;
    const text = result?.content?.[0]?.text ?? "";
    let data: Record<string, unknown> | null = null;
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      data = null;
    }
    if (result?.isError) console.log(`   [tool ${name} error] ${text.slice(0, 160)}`);
    return { ok: !result?.isError, data, error: result?.isError ? text : "" };
  }

  let userId = "";
  let blogId = "";
  const auditRows = (actionName: string, targetId?: string) =>
    db!
      .select({ id: actionAudit.id })
      .from(actionAudit)
      .where(
        and(
          eq(actionAudit.actorUserId, userId),
          eq(actionAudit.actionName, actionName),
          ...(targetId ? [eq(actionAudit.targetId, targetId)] : []),
        ),
      );

  try {
    // ---- Setup: isolated scratch workspace + MCP-capable token ----
    const [u] = await db
      .insert(users)
      .values({ appleSub: SUB, username: HANDLE, name: "Workflow Verify" })
      .returning({ id: users.id });
    userId = u.id;
    const [b] = await db
      .insert(blogs)
      .values({ handle: HANDLE, name: "Workflow Verify", ownerId: userId })
      .returning({ id: blogs.id });
    blogId = b.id;
    await ensureWorkspaceFolders(blogId);
    await db
      .insert(apiTokens)
      .values({ userId, name: "scratch-workflow", tokenHash: hashApiToken(token), scopes: "sync" });
    console.log(`scratch workspace ${HANDLE} ready; driving ${ORIGIN}/api/mcp\n`);

    // Sanity: the token can reach the shared command surface.
    const ws = await tool("get_workspace", {});
    check(
      "MCP get_workspace reaches the isolated workspace",
      ws.ok && (ws.data?.workspace as { handle?: string })?.handle === HANDLE,
      String((ws.data?.workspace as { handle?: string })?.handle ?? ws.error),
    );

    // ---- Workflow: folder_trash_restore ----
    const created = await tool("create_folder", { parent_path: "blog", name: `Ideas ${STAMP}` });
    const folderId = (created.data?.folder as { id?: string })?.id ?? "";
    const del = await tool("delete_folder", { folder_id: folderId });
    const [trashed] = await db.select().from(folders).where(eq(folders.id, folderId));
    const restore = await tool("restore_folder", { folder_id: folderId });
    const [restored] = await db.select().from(folders).where(eq(folders.id, folderId));
    check(
      "folder_trash_restore mutates the folder both ways",
      created.ok && del.ok && restore.ok && !!trashed?.deletedAt && !restored?.deletedAt,
      `trashed=${!!trashed?.deletedAt} restored=${!restored?.deletedAt}`,
    );
    check(
      "folder_trash_restore leaves audit rows",
      (await auditRows("mcp.create_folder")).length > 0 &&
        (await auditRows("mcp.delete_folder", folderId)).length > 0 &&
        (await auditRows("mcp.restore_folder", folderId)).length > 0,
    );

    // ---- Workflow: folder_rename (the store's rename sanitization + CAS) ----
    const renamed = await tool("rename_folder", {
      folder_id: folderId,
      name: `Renamed ${STAMP}`,
    });
    const [afterRename] = await db.select().from(folders).where(eq(folders.id, folderId));
    check(
      "rename_folder changes the display name (id and path stable)",
      renamed.ok && afterRename?.name === `Renamed ${STAMP}`,
      `name=${afterRename?.name ?? renamed.error}`,
    );
    check(
      "rename_folder leaves an audit row",
      (await auditRows("mcp.rename_folder", folderId)).length > 0,
    );

    // ---- Base article for the comment + cover workflows ----
    const article = await tool("create_item", {
      folder_path: "blog",
      kind: "article",
      title: `Workflow Article ${STAMP}`,
      body: "Body text for the workflow probe.",
    });
    const articleId = (article.data?.item as { id?: string })?.id ?? "";
    check("create_item produced an article", article.ok && !!articleId, articleId);

    // ---- Flagship workflow: notes -> grounded Living brief -> source drift ----
    const sourceOne = await tool("create_item", {
      folder_path: "notes",
      kind: "note",
      title: `Interview evidence ${STAMP}`,
      body: "Three writers said they trusted the agent only after they could inspect its exact evidence and undo a narrow change.",
    });
    const sourceTwo = await tool("create_item", {
      folder_path: "notes",
      kind: "note",
      title: `Workflow decision ${STAMP}`,
      body: "The launch workflow is source notes, a grounded brief, review of affected claims, then a private publication draft.",
    });
    const sourceOneId = (sourceOne.data?.item as { id?: string })?.id ?? "";
    const sourceTwoId = (sourceTwo.data?.item as { id?: string })?.id ?? "";
    const readSourceOne = await tool("read_item", { id: sourceOneId });
    const readSourceTwo = await tool("read_item", { id: sourceTwoId });
    const sourceOneHash =
      (readSourceOne.data?.item as { hash?: string })?.hash ?? "";
    const sourceTwoHash =
      (readSourceTwo.data?.item as { hash?: string })?.hash ?? "";
    check(
      "Living brief sources expose exact captured versions",
      sourceOne.ok && sourceTwo.ok && !!sourceOneHash && !!sourceTwoHash,
      `first=${sourceOneHash ? "hashed" : "missing"} second=${sourceTwoHash ? "hashed" : "missing"}`,
    );

    const brief = await tool("create_item", {
      folder_path: "blog",
      kind: "article",
      title: `Agentic writing launch brief ${STAMP}`,
      excerpt: "A source-grounded launch decision.",
      body: "Ship one visible writing loop: evidence becomes addressable claims, source changes identify affected claims, and supported claims become a private publication draft.",
      template_id: "texttext.brief",
      template_version: 1,
      fields: {
        audience: "Product and engineering",
        purpose: "Approve the smallest complete agentic writing loop",
        sources: [
          {
            sourceId: "interviews",
            title: `Interview evidence ${STAMP}`,
            itemId: sourceOneId,
            capturedHash: sourceOneHash,
            status: "current",
          },
          {
            sourceId: "decision",
            title: `Workflow decision ${STAMP}`,
            itemId: sourceTwoId,
            capturedHash: sourceTwoHash,
            status: "current",
          },
        ],
        claims: [
          {
            claimId: "trust-requires-proof",
            claim: "Visible evidence and narrow recovery increase trust.",
            sourceId: "interviews",
            evidence:
              "Writers trusted the agent after they could inspect evidence and undo a narrow change.",
            status: "supported",
          },
          {
            claimId: "workflow-order",
            claim: "The complete workflow ends in a private publication draft.",
            sourceId: "decision",
            evidence:
              "Source notes lead to a brief, affected-claim review, and a private publication draft.",
            status: "supported",
          },
        ],
        writingRules: [
          {
            instruction: "Use plain language and name the evidence.",
            scope: "document",
            enabled: true,
          },
          {
            instruction: "Use only supported claims.",
            scope: "publication",
            enabled: true,
          },
        ],
      },
    });
    const briefId = (brief.data?.item as { id?: string })?.id ?? "";
    const grounding = brief.data?.grounding as
      { sources?: number; claims?: number; writingRules?: number } | undefined;
    const [briefRow] = briefId
      ? await db.select().from(posts).where(eq(posts.id, briefId))
      : [];
    check(
      "notes become one validated, addressable Living brief",
      brief.ok &&
        !!briefId &&
        grounding?.sources === 2 &&
        grounding?.claims === 2 &&
        grounding?.writingRules === 2 &&
        briefRow?.document?.presentation.template.id === "texttext.brief",
      `sources=${grounding?.sources ?? 0} claims=${grounding?.claims ?? 0} rules=${grounding?.writingRules ?? 0}`,
    );
    check(
      "Living brief creation leaves one attributed audit",
      (await auditRows("mcp.create_item", briefId)).length === 1,
    );

    const changedSource = await tool("update_item", {
      id: sourceOneId,
      body: "Five writers said they trusted the agent only after they could inspect exact evidence, see the affected claim, and undo a narrow change.",
      if_match_hash: sourceOneHash,
    });
    const reviewBrief = await tool("review_brief_sources", { id: briefId });
    const reviewSummary = reviewBrief.data?.summary as
      { changed?: number; affectedClaims?: number } | undefined;
    const affectedClaimIds = (
      (reviewBrief.data?.affectedClaims ?? []) as Array<{
        claimId?: string;
      }>
    ).map((claim) => claim.claimId);
    check(
      "a changed source identifies only its affected claim",
      changedSource.ok &&
        reviewBrief.ok &&
        reviewSummary?.changed === 1 &&
        reviewSummary?.affectedClaims === 1 &&
        affectedClaimIds.join(",") === "trust-requires-proof",
      `changed=${reviewSummary?.changed ?? 0} claims=${affectedClaimIds.join(",") || "none"}`,
    );

    // ---- Workflow: comments ----
    const commented = await tool("add_comment", { id: articleId, body: "A probe comment." });
    const commentId = (commented.data?.comment as { id?: string })?.id ?? "";
    const resolved = await tool("set_comment_resolved", { id: articleId, comment_id: commentId, resolved: true });
    const commentRows = await db.select().from(itemComments).where(eq(itemComments.postId, articleId));
    check(
      "comments workflow creates and resolves a comment",
      commented.ok && resolved.ok && commentRows.length > 0 && !!commentRows[0]?.resolvedAt,
      `rows=${commentRows.length} resolved=${!!commentRows[0]?.resolvedAt}`,
    );
    check(
      "comments workflow leaves audit rows",
      (await auditRows("mcp.add_comment", articleId)).length > 0 &&
        (await auditRows("mcp.resolve_comment", articleId)).length > 0,
    );

    // ---- Workflow: cover_assets ----
    // Attach a public TextText image as an asset and use it as the cover in one
    // step. The asset importer correctly rejects localhost and private hosts.
    const cover = await tool("add_item_asset", {
      id: articleId,
      source_url: ASSET_FIXTURE_URL,
      placement: "cover",
      alt_text: "Cover art",
    });
    const [withCover] = await db.select().from(posts).where(eq(posts.id, articleId));
    check(
      "cover_assets workflow attaches an asset as the cover",
      cover.ok && !!withCover?.cover,
      `cover=${withCover?.cover ? "set" : "none"}`,
    );
    check(
      "cover_assets workflow leaves an audit row",
      (await auditRows("mcp.add_item_asset", articleId)).length > 0,
    );

    // ---- Workflow: sharing_access ----
    const grant = await tool("set_access", {
      scope_type: "workspace",
      email: `friend-${STAMP}@example.com`,
      role: "member",
    });
    const collabRows = await db.select().from(collaborators).where(eq(collaborators.scopeId, blogId));
    check(
      "sharing_access workflow grants a collaborator",
      grant.ok && collabRows.length > 0,
      `collaborators=${collabRows.length}`,
    );
    check("sharing_access workflow leaves an audit row", (await auditRows("mcp.set_access")).length > 0);

    // ---- Workflow: access role lifecycle (set role + revoke) ----
    const accessId = (collabRows[0] as { id?: string })?.id ?? "";
    if (!accessId) {
      throw new Error("set_access did not return a durable collaborator.");
    }
    const roleChanged = await tool("set_access", {
      scope_type: "workspace",
      email: `friend-${STAMP}@example.com`,
      role: "guest",
    });
    const [afterRole] = await db
      .select()
      .from(collaborators)
      .where(eq(collaborators.id, accessId));
    check(
      "set_access changes the grant's role",
      roleChanged.ok && afterRole?.role === "guest",
      `role=${afterRole?.role ?? roleChanged.error}`,
    );
    const revoked = await tool("revoke_access", {
      scope_type: "workspace",
      access_id: accessId,
    });
    const [afterRevoke] = await db
      .select()
      .from(collaborators)
      .where(eq(collaborators.id, accessId));
    check(
      "revoke_access soft-revokes the grant (revoked_at set)",
      revoked.ok && !!afterRevoke?.revokedAt,
      `revokedAt=${!!afterRevoke?.revokedAt}`,
    );
    check(
      "access role lifecycle leaves audit rows",
      (await auditRows("mcp.set_access")).length > 1 &&
        (await auditRows("mcp.revoke_access")).length > 0,
    );

    // ---- Workflow: bookmark_recapture ----
    const bookmark = await tool("create_item", {
      folder_path: "bookmarks",
      kind: "bookmark",
      title: `Bookmark ${STAMP}`,
      body: "A saved link.",
    });
    const bookmarkId = (bookmark.data?.item as { id?: string })?.id ?? "";
    // Precondition (not the thing under test): recapture needs an original link
    // to re-fetch. Seed one directly on the scratch row.
    if (bookmarkId) {
      await db
        .update(posts)
        .set({ links: [{ href: "https://example.com/", label: "Example" }] })
        .where(eq(posts.id, bookmarkId));
    }
    const recap = await tool("recapture_bookmark", { id: bookmarkId });
    const [recaptured] = await db.select().from(posts).where(eq(posts.id, bookmarkId));
    check(
      "bookmark_recapture re-enqueues a capture",
      bookmark.ok && recap.ok && recaptured?.captureStatus === "pending",
      `status=${recaptured?.captureStatus}`,
    );
    check(
      "bookmark_recapture leaves an audit row",
      (await auditRows("mcp.recapture_bookmark", bookmarkId)).length > 0,
    );
  } finally {
    if (blogId) {
      const blogPosts = await db
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.blogId, blogId));
      if (blogPosts.length) {
        await db
          .delete(itemComments)
          .where(inArray(itemComments.postId, blogPosts.map((p) => p.id)))
          .catch(() => {});
      }
      await db.delete(collaborators).where(eq(collaborators.scopeId, blogId));
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.blogId, blogId)).catch(() => {});
      await db.delete(posts).where(eq(posts.blogId, blogId));
      await db.delete(folders).where(eq(folders.blogId, blogId));
      await db.delete(blogs).where(eq(blogs.id, blogId));
    }
    if (userId) {
      await db.delete(apiTokens).where(eq(apiTokens.userId, userId));
      await db.delete(actionAudit).where(eq(actionAudit.actorUserId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    console.log("\nscratch workspace torn down.");
  }

  console.log(`\n==== ${pass.length} passed, ${fail.length} failed ====`);
  if (fail.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
