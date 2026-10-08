import type { AuthInfo, CallToolResult } from "./types";
import { hasItemAgentScope, itemAgentAccess, itemAgentAllows } from "@/lib/item-agent-access";
import { getOwnedBlog, getBlog, getBlogEditRecord, getUserIdBySub, listVaultTextpacks, readVaultTextpack, readVaultTextpackIdentity } from "@/lib/store";
import { activeVaultGrants, roleForVaultItem } from "@/lib/vault/grants";
import { openPack } from "@/local-vault/pack";
import { readDocument } from "@/local-vault/model";

const reads = ["get_workspace", "list_items", "read_item", "search"] as const;
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
  if (!(reads as readonly string[]).includes(name)) return error(`The file workspace does not support ${name} through this connection yet.`);
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
  if (!owner && !grants.length) return error("Workspace not found.");
  if (name === "get_workspace") return json({ workspace: { id: identity.id, handle: blog.handle, name: blog.name }, access: { owner, canEdit: false }, capabilities: { tools: reads, fileBased: true, writes: false } });
  let bytesRead = 0;
  async function read(item: { itemId: string; relativePath: string }) {
    // Check current identity/path again: a folder move can revoke a folder grant.
    const current = await readVaultTextpackIdentity({ ...location, itemId: item.itemId });
    if (!current || !allowed(current)) return null;
    const pack = await readVaultTextpack({ ...location, itemId: item.itemId });
    if (!pack || !allowed({ itemId: item.itemId, relativePath: pack.relativePath })) return null;
    bytesRead += pack.bytes.byteLength;
    if (bytesRead > 64 * 1024 * 1024) throw new Error("File read budget exceeded; narrow the folder or query.");
    const document = readDocument(openPack(pack.bytes, pack.relativePath, pack.revision, item.itemId).file);
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
  const limit = Math.min(name === "search" ? 50 : 100, Math.max(1, typeof args.limit === "number" ? args.limit : name === "search" ? 25 : 50));
  const folder = typeof args.folder_path === "string" ? args.folder_path.replace(/\/$/, "") : null;
  const terms = typeof args.query === "string" ? args.query.toLocaleLowerCase().split(/\s+/).filter(Boolean) : [];
  if (name === "search" && !terms.length) return error("Enter a search query.");
  const items = [];
  let scanned = 0;
  for (const entry of visible) {
    if (folder !== null && entry.relativePath.slice(0, entry.relativePath.lastIndexOf("/")) !== folder) continue;
    if (++scanned > 500) break;
    const item = await read(entry);
    if (!item) continue;
    if (name === "search" && !terms.every((term) => `${item.title}\n${item.body}`.toLocaleLowerCase().includes(term))) continue;
    items.push({ id: item.id, path: item.path, hash: item.hash, title: item.title, excerpt: item.body.slice(0, 400) });
    if (items.length >= limit) break;
  }
  return json({ items, truncated: scanned > 500 || items.length >= limit, ...(owner ? { problems: manifest.problems } : {}) });
}
