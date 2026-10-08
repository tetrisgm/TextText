import type { AuthInfo, CallToolResult } from "./types";
import { hasItemAgentScope, itemAgentAccess, itemAgentAllows } from "@/lib/item-agent-access";
import { getOwnedBlog, getBlog, getBlogEditRecord, getUserIdBySub, listVaultTextpacks, readVaultTextpack, readVaultTextpackIdentity, readVaultPreview, searchVaultTextpacks } from "@/lib/store";
import { activeVaultGrants, roleForVaultItem, roleForVaultFolder } from "@/lib/vault/grants";
import { openPack } from "@/local-vault/pack";
import { readDocument } from "@/local-vault/model";

import { VAULT_TOOL_NAMES } from "./vault-contract";
const reads = ["get_workspace", "list_folders", "list_items", "read_item", "search"] as const;
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
  const canWrite = !readOnly && (itemScope?.role === "edit" || scopes.includes("sync"));
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
      const action = () => mutateVaultTool(name, args, { ...location, actorUserId: userId, authorize });
      if (name === "create_item") return json(await action());
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
    const document = readDocument(openPack(pack.bytes, pack.relativePath, pack.revision, item.itemId).file);
    if (!await allowedNow({ itemId: item.itemId, relativePath: pack.relativePath })) return null;
    return { id: item.itemId, path: pack.relativePath, hash: pack.revision, title: document.content.title, body: document.content.body, document };
  }
  if (name === "read_item") {
    if (typeof args.id !== "string") return error("Item not found.");
    const identity = await readVaultTextpackIdentity({ ...location, itemId: args.id });
    if (!identity || !allowed(identity)) return error("Item not found.");
    const item = await read(identity);
    return item ? json({ item }) : error("Item not found.");
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
    for (const hit of found.items) {
      const entry = visible.find((item) => item.relativePath === hit.path);
      if (!entry) continue;
      const current = await readVaultTextpackIdentity({ ...location, itemId: entry.itemId });
      if (!current || current.relativePath !== hit.path || current.revision !== entry.revision || !await allowedNow(current)) continue;
      items.push({ id: entry.itemId, ...hit, hash: current.revision });
      if (items.length >= limit) break;
    }
    return json({ items, truncated: found.truncated || found.items.length > limit });
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
