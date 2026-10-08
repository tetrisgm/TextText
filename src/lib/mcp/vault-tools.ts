import { randomUUID } from "node:crypto";
import type { AuthInfo, CallToolResult } from "./types";
import { hasItemAgentScope, itemAgentAccess, itemAgentAllows } from "@/lib/item-agent-access";
import { getOwnedBlog, getBlog, getBlogEditRecord, getUserIdBySub, listVaultTextpacks, readVaultTextpack, readVaultTextpackIdentity, readVaultPreview, searchVaultTextpacks } from "@/lib/store";
import { activeVaultGrants, roleForVaultItem, roleForVaultFolder } from "@/lib/vault/grants";
import { openPack } from "@/local-vault/pack";
import { readVaultPublicationFromPack } from "@/lib/vault/publication";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { readDocument } from "@/local-vault/model";

import { VAULT_TOOL_NAMES } from "./vault-contract";
function summary(id: string, path: string, hash: string, title: string, document: DocumentSnapshot, published = false) {
  const template = document.presentation.template.id;
  const kind = template === "texttext.article" ? "article" : template === "texttext.bookmark" ? "bookmark" : template === "texttext.gallery" ? "media_post" : template === "texttext.talk" ? "talk" : "note";
  return { id, path, slug: id, hash, title, kind, status: published ? "published" : "draft", folder_path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" };
}
const reads = ["get_workspace", "list_folders", "list_items", "read_item", "search", "list_comments"] as const;
const json = (value: Record<string, unknown>): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
const error = (text: string): CallToolResult => ({ content: [{ type: "text", text }], isError: true });
/** File-only backend. Never returns null to request a legacy SQL fallback.
 * Call after tool schema/scope validation. Identity and file grants are checked
 * again here so this adapter cannot inherit legacy collaborator authority.
 */
export async function executeVaultReadTool(name: string, args: Record<string, unknown>, auth: AuthInfo | undefined): Promise<CallToolResult> {
  const sub = auth?.extra?.sub;
  if (typeof sub !== "string" || !sub) return error("Sign in required.");
  const scopes = auth?.scopes ?? [];
  const itemScope = itemAgentAccess(scopes);
  if (hasItemAgentScope(scopes) && !itemAgentAllows(scopes, name, args)) return error("This connection can only access its granted item.");
  if (!itemScope && !scopes.some((scope) => scope === "sync" || /^(read|readonly|read-only)$/.test(scope.trim().toLowerCase()) || /(?:^|[:./_-])read(?:[-_]?only)?$/.test(scope.trim().toLowerCase()))) return error("This token has no supported workspace scope.");
  if (!(VAULT_TOOL_NAMES as readonly string[]).includes(name)) return error(`The file workspace does not support ${name} through this connection yet.`);
  const root = process.env.TEXTTEXT_VAULT_ROOT;
  if (!root) return error("File workspace storage is not configured.");
  const userId = await getUserIdBySub(sub);
  if (!userId) return error("Account not found.");
  const requestedHandle = auth?.extra?.workspaceHandle;
  const blog = typeof requestedHandle === "string" && requestedHandle ? await getBlog(requestedHandle) : await getOwnedBlog(sub);
  if (!blog) return error("Workspace not found.");
  const identity = await getBlogEditRecord(blog.handle);
  if (!identity) return error("Workspace not found.");
  const location = { root, workspaceId: identity.id };
  const owner = identity.ownerId === userId;
  const grants = owner ? [] : await activeVaultGrants({ ...location, userId });
  const allowed = (item: { itemId: string; relativePath: string }) =>
    (!itemScope || itemScope.itemId === item.itemId) && (owner || Boolean(roleForVaultItem(grants, item.itemId, item.relativePath)));
  async function allowedNow(item: { itemId: string; relativePath: string }) {
    if (itemScope && itemScope.itemId !== item.itemId) return false;
    const currentUser = await getUserIdBySub(sub as string);
    if (!currentUser || currentUser !== userId) return false;
    const currentWorkspace = await getBlogEditRecord(blog!.handle);
    if (!currentWorkspace || currentWorkspace.id !== location.workspaceId) return false;
    return currentWorkspace.ownerId === currentUser || Boolean(roleForVaultItem(await activeVaultGrants({ ...location, userId: currentUser }), item.itemId, item.relativePath));
  }
  if (!owner && !grants.length) return error("Workspace not found.");
  const readOnly = scopes.some((scope) => /^(read|readonly|read-only)$/.test(scope.trim().toLowerCase()) || /(?:^|[:./_-])read(?:[-_]?only)?$/.test(scope.trim().toLowerCase()));
  const actorType = auth?.extra?.actorType === "human" ? "human" as const : "external_agent" as const;
  const canWrite = !readOnly && (itemScope?.role === "edit" || scopes.includes("sync"));
  if (["list_comments", "add_comment", "set_comment_resolved"].includes(name)) {
    if (name !== "list_comments" && !canWrite) return error("This connection is read-only.");
    const authorize = async (itemId: string, path: string, write: boolean) => {
      const currentPath = path || (await readVaultTextpackIdentity({ ...location, itemId }))?.relativePath;
      if (!currentPath || !await allowedNow({ itemId, relativePath: currentPath })) throw new Error("Item not found.");
      if (write) {
        const currentWorkspace = await getBlogEditRecord(blog.handle);
        if (currentWorkspace?.id !== location.workspaceId) throw new Error("Item access changed.");
        if (currentWorkspace.ownerId !== userId && roleForVaultItem(await activeVaultGrants({ ...location, userId }), itemId, currentPath) !== "editor") throw new Error("Item editing is not allowed.");
      }
    };
    try {
      const { executeVaultCommentTool } = await import("./vault-comments");
      const connectionName = actorType === "human"
        ? (typeof auth?.extra?.name === "string" ? auth.extra.name : typeof auth?.extra?.email === "string" ? auth.extra.email : "TextText user")
        : typeof auth?.extra?.connectionName === "string" ? auth.extra.connectionName : "Connected agent";
      const action = () => executeVaultCommentTool(name, args, { ...location, actorUserId: userId, actorType, actorName: connectionName, operationId: randomUUID(), authorize });
      if (name === "list_comments" || actorType === "human") return json(await action());
      const { withVaultAgentPresence } = await import("./vault-agent-presence");
      return json(await withVaultAgentPresence({ ...location, itemId: String(args.id), actorUserId: userId, connectionName,
        connectionId: typeof auth?.extra?.connectionId === "string" ? auth.extra.connectionId : undefined,
        authorize: (path) => authorize(String(args.id), path, true) }, action));
    } catch (cause) { return error(cause instanceof Error ? cause.message : "The comment command failed."); }
  }
  if (!(reads as readonly string[]).includes(name)) {
    if (!canWrite) return error("This connection is read-only.");
    const { mutateVaultTool } = await import("./vault-mutations");
    const authorize = async (itemId: string, path: string, creating: boolean) => {
      const currentUser = await getUserIdBySub(sub as string);
      const currentWorkspace = await getBlogEditRecord(blog.handle);
      if (currentUser !== userId || currentWorkspace?.id !== location.workspaceId || (itemScope && itemScope.itemId !== itemId)) throw new Error("Item access changed.");
      if (currentWorkspace.ownerId === currentUser) return;
      const currentGrants = await activeVaultGrants({ ...location, userId });
      const currentPath = path || (await readVaultTextpackIdentity({ ...location, itemId }))?.relativePath;
      if (!currentPath) throw new Error("Item not found.");
      const slash = currentPath.lastIndexOf("/");
      const role = creating ? roleForVaultFolder(currentGrants, slash < 0 ? "" : currentPath.slice(0, slash)) : roleForVaultItem(currentGrants, itemId, currentPath);
      if (role !== "editor") throw new Error("Item editing is not allowed.");
    };
    try {
      if (name === "move_item" || name === "delete_item") {
        const { organizeVaultItem } = await import("./vault-organization");
        return json(await organizeVaultItem(name, args, { ...location, actorUserId: userId, actorType, authorize }));
      }
      const action = async () => {
        const receipt = await mutateVaultTool(name, args, { ...location, actorUserId: userId, actorType, authorize });
        if (receipt.status === "conflict") throw new Error("The item changed. Read it again before editing.");
        const current = await readVaultTextpack({ ...location, itemId: receipt.itemId });
        if (!current || !await allowedNow({ itemId: receipt.itemId, relativePath: current.relativePath })) throw new Error("Item not found.");
        const document = readDocument(openPack(current.bytes, current.relativePath, current.revision, receipt.itemId).file);
        if (!await allowedNow({ itemId: receipt.itemId, relativePath: current.relativePath })) throw new Error("Item not found.");
        const item = summary(receipt.itemId, current.relativePath, current.revision, document.content.title, document, Boolean(readVaultPublicationFromPack(current.bytes)));
        return { ...receipt, item, ...(name === "create_item" ? { receipt: { item_id: item.id, kind: item.kind, saved_to: item.folder_path, title: item.title, path: item.path } } : {}) };
      };
      if (name === "create_item" || actorType === "human") return json(await action());
      const { withVaultAgentPresence } = await import("./vault-agent-presence");
      return json(await withVaultAgentPresence({ ...location, itemId: String(args.id), actorUserId: userId,
        connectionName: typeof auth?.extra?.connectionName === "string" ? auth.extra.connectionName : "Connected agent",
        connectionId: typeof auth?.extra?.connectionId === "string" ? auth.extra.connectionId : undefined,
        authorize: (path) => authorize(String(args.id), path, false) }, action));
    }
    catch (cause) { return error(cause instanceof Error ? cause.message : "The file command failed."); }
  }
  if (name === "get_workspace") return json({ workspace: { id: identity.id, handle: blog.handle, name: blog.name }, access: { owner, canEdit: owner && canWrite }, capabilities: { tools: VAULT_TOOL_NAMES, fileBased: true, writes: canWrite, publication: false, memberManagement: false, agentChangeRevert: false } });
  let bytesRead = 0;
  async function read(item: { itemId: string; relativePath: string }) {
    // Check current identity/path again: a folder move can revoke a folder grant.
    const current = await readVaultTextpackIdentity({ ...location, itemId: item.itemId });
    if (!current || !await allowedNow(current)) return null;
    const pack = await readVaultTextpack({ ...location, itemId: item.itemId });
    if (!pack || !allowed({ itemId: item.itemId, relativePath: pack.relativePath })) return null;
    bytesRead += pack.bytes.byteLength;
    if (bytesRead > 64 * 1024 * 1024) throw new Error("File read budget exceeded; narrow the folder or query.");
    const opened = openPack(pack.bytes, pack.relativePath, pack.revision, item.itemId);
    const document = readDocument(opened.file);
    if (!await allowedNow({ itemId: item.itemId, relativePath: pack.relativePath })) return null;
    return { ...summary(item.itemId, pack.relativePath, pack.revision, document.content.title, document, Boolean(readVaultPublicationFromPack(pack.bytes))), body: document.content.body, document, markdown: opened.file.markdown };
  }
  if (name === "read_item") {
    if (typeof args.id !== "string") return error("Item not found.");
    const identity = await readVaultTextpackIdentity({ ...location, itemId: args.id });
    if (!identity || !allowed(identity)) return error("Item not found.");
    const item = await read(identity);
    return item ? json({ item, markdown: item.markdown, assets: item.document.content.assets }) : error("Item not found.");
  }
  const manifest = await listVaultTextpacks(location);
  const visible = manifest.items.filter(allowed);
  if (name === "list_folders") {
    const currentUser = await getUserIdBySub(sub);
    const currentWorkspace = await getBlogEditRecord(blog.handle);
    if (currentUser !== userId || currentWorkspace?.id !== location.workspaceId) return error("Workspace access changed.");
    const currentGrants = currentWorkspace.ownerId === userId ? [] : await activeVaultGrants({ ...location, userId });
    return json({ folders: manifest.folders.filter((folder) => currentWorkspace.ownerId === userId || Boolean(roleForVaultFolder(currentGrants, folder))).map((path) => ({ path, name: path.split("/").at(-1) })) });
  }
  const limit = Math.min(name === "search" ? 50 : 100, Math.max(1, typeof args.limit === "number" ? args.limit : name === "search" ? 25 : 50));
  const folder = typeof args.folder_path === "string" ? args.folder_path.replace(/\/$/, "") : null;
  const terms = typeof args.query === "string" ? args.query.toLocaleLowerCase().split(/\s+/).filter(Boolean) : [];
  if (name === "search" && !terms.length) return error("Enter a search query.");
  const items = [];
  if (name === "search") {
    const found = await searchVaultTextpacks(location, visible, String(args.query));
    let remainingPreviewBytes = 64 * 1024 * 1024;
    let previewSkipped = false;
    for (const hit of found.items) {
      const entry = visible.find((item) => item.relativePath === hit.path);
      if (!entry) continue;
      const current = await readVaultTextpackIdentity({ ...location, itemId: entry.itemId });
      if (!current || current.relativePath !== hit.path || current.revision !== entry.revision || !await allowedNow(current)) continue;
      const preview = await readVaultPreview({ ...location, itemId: entry.itemId, metadataOnly: true, maxBytes: remainingPreviewBytes });
      if (preview) remainingPreviewBytes -= preview.sourceBytes;
      else previewSkipped = true;
      const after = await readVaultTextpackIdentity({ ...location, itemId: entry.itemId });
      if (!preview || !after || after.revision !== current.revision || after.relativePath !== current.relativePath || !await allowedNow(after)) continue;
      items.push({ ...hit, ...summary(entry.itemId, after.relativePath, after.revision, preview.title, preview.document, Boolean(preview.publishedAt)) });
      if (items.length >= limit) break;
    }
    return json({ query: args.query, results: items, items, truncated: previewSkipped || found.truncated || found.items.length > limit });
  }
  let scanned = 0;
  for (const entry of visible) {
    const slash = entry.relativePath.lastIndexOf("/");
    const parent = slash < 0 ? "" : entry.relativePath.slice(0, slash);
    if (folder !== null && parent !== folder) continue;
    if (++scanned > 500) break;
    if (!await allowedNow(entry)) continue;
    const preview = await readVaultPreview({ ...location, itemId: entry.itemId, metadataOnly: true });
    const current = await readVaultTextpackIdentity({ ...location, itemId: entry.itemId });
    if (!preview || !current || current.relativePath !== entry.relativePath || current.revision !== entry.revision || !await allowedNow(current)) continue;
    items.push({ id: entry.itemId, path: current.relativePath, hash: current.revision, title: preview.title, excerpt: preview.excerpt });
    if (items.length >= limit) break;
  }
  return json({ items, truncated: scanned > 500 || items.length >= limit });
}
