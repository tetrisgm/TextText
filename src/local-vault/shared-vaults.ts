export type SharedVaultWorkspace = {
  id: string;
  name: string;
  items: { itemId: string; relativePath: string }[];
  folders: string[];
};
export type VaultAccess = {
  fullAccess: boolean;
  isOwner: boolean;
  canEditContent: boolean;
  canComment: boolean;
  canManageShares: boolean;
  grants: { scopeType: "item" | "folder"; scopeKey: string; role: "viewer" | "commenter" | "editor" }[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validPath = (value: unknown, textpack: boolean): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 1000 && !value.startsWith("/") &&
  (!textpack || value.endsWith(".textpack")) &&
  value.split("/").every(segment => segment.length > 0 && segment !== "." && segment !== "..");

const itemIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function parseSharedVaults(value: unknown): SharedVaultWorkspace[] {
  const data = value as { workspaces?: unknown } | null;
  if (!data || !Array.isArray(data.workspaces) || data.workspaces.length > 100) throw new Error("The shared workspace list is invalid.");
  return data.workspaces.map((entry): SharedVaultWorkspace => {
    const row = entry as Partial<SharedVaultWorkspace> | null;
    if (!row || typeof row.id !== "string" || !uuid.test(row.id) || typeof row.name !== "string" ||
        row.name.length > 200 || !Array.isArray(row.items) || !Array.isArray(row.folders) ||
        row.items.length > 100_000 || row.folders.length > 10_000 ||
        row.items.some(item => !item || typeof item.itemId !== "string" || !itemIdPattern.test(item.itemId) || !validPath(item.relativePath, true)) ||
        row.folders.some(folder => !validPath(folder, false))) {
      throw new Error("The shared workspace list is invalid.");
    }
    return { id: row.id, name: row.name, items: row.items, folders: row.folders };
  });
}

export function parseVaultAccess(value: unknown): VaultAccess {
  const data = value as Partial<VaultAccess> | null;
  if (!data || typeof data.fullAccess !== "boolean" || typeof data.isOwner !== "boolean" ||
      typeof data.canEditContent !== "boolean" || typeof data.canComment !== "boolean" ||
      typeof data.canManageShares !== "boolean" || !Array.isArray(data.grants) || data.grants.length > 10_000 ||
      data.grants.some(grant => !grant || !["item", "folder"].includes(grant.scopeType) ||
        typeof grant.scopeKey !== "string" || grant.scopeKey.length > 1000 || !["viewer", "commenter", "editor"].includes(grant.role))) {
    throw new Error("The workspace access details are invalid.");
  }
  return data as VaultAccess;
}

export function canCreateInVaultFolder(access: VaultAccess | null, folder: string): boolean {
  if (!access) return false;
  if (access.fullAccess) return access.canEditContent;
  return access.grants.some(grant => grant.scopeType === "folder" && grant.role === "editor" &&
    (folder === grant.scopeKey || folder.startsWith(`${grant.scopeKey}/`)));
}

export function canViewVaultFolder(access: VaultAccess | null, folder: string): boolean {
  if (!access) return false;
  if (access.fullAccess) return true;
  return access.grants.some(grant => grant.scopeType === "folder" &&
    (folder === grant.scopeKey || folder.startsWith(`${grant.scopeKey}/`)));
}

export function sharedWorkspaceHref(id: string): string {
  if (!uuid.test(id)) throw new Error("Invalid shared workspace identifier");
  return `/vault/${encodeURIComponent(id)}`;
}

export function sharedFileHref(workspaceId: string, itemId: string): string {
  if (!itemIdPattern.test(itemId)) throw new Error("Invalid shared file identifier");
  return `${sharedWorkspaceHref(workspaceId)}?item=${encodeURIComponent(itemId)}`;
}

export function sharedFolderHref(workspaceId: string, relativePath: string): string {
  if (!validPath(relativePath, false)) throw new Error("Invalid shared folder path");
  return `${sharedWorkspaceHref(workspaceId)}#folder=${encodeURIComponent(relativePath)}`;
}

/** Interpret a local fragment only against the current authorized listing. */
export function sharedVaultHashTarget(hash: string, files: readonly string[], folders: readonly string[]):
  { type: "file" | "folder"; path: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const file = params.get("file");
  if (file && files.includes(file)) return { type: "file", path: file };
  const folder = params.get("folder");
  if (folder && folders.includes(folder)) return { type: "folder", path: folder };
  return null;
}

/** Resolve a stable item link only through the current permission-filtered listing. */
export function sharedVaultLinkTarget(search: string, hash: string,
  items: readonly { path: string; itemId?: string }[], folders: readonly string[]):
  { type: "file" | "folder"; path: string } | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const itemId = params.get("item");
  if (itemId !== null) {
    if (!itemIdPattern.test(itemId)) return null;
    const item = items.find(candidate => candidate.itemId === itemId);
    return item ? { type: "file", path: item.path } : null;
  }
  return sharedVaultHashTarget(hash, items.map(item => item.path), folders);
}
