import { createHash } from "node:crypto";

export interface FolderMoveGrant {
  id: string;
  path: string;
  signature: string;
  email: string;
  role: "viewer" | "commenter" | "editor";
}
export interface FolderMoveItem { itemId: string; relativePath: string; revision: string }
const within = (value: string, parent: string) => value === parent || value.startsWith(`${parent}/`);
const rank = { viewer: 1, commenter: 2, editor: 3 };
function folder(value: string) {
  if (!value || value.length > 1000 || value.split("/").some(part => !part || part.startsWith(".") || /[\\\x00-\x1f:?*"<>|]/.test(part) || /[. ]$/.test(part) || part.toLowerCase().endsWith(".textpack") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw Error("Invalid folder path");
  return value;
}

/** Pure immutable preview. Filesystem identities and current grant rows must be
 * authenticated by the caller before this plan can become a durable intent. */
export function planFolderMove(input: {
  source: string; destination: string; manifestRevision: string;
  folders: readonly string[]; items: readonly FolderMoveItem[];
  grants: readonly FolderMoveGrant[];
}) {
  const source = folder(input.source), destination = folder(input.destination);
  const grants = input.grants.map(grant => ({ ...grant, email: grant.email.trim().toLowerCase() })).sort((a,b) => a.id.localeCompare(b.id));
  const canonical = (value: string) => value.normalize("NFC").toLowerCase();
  if (within(canonical(destination), canonical(source)) || canonical(source) === canonical(destination)) throw Error("Destination must be outside the source folder");
  if (!/^[a-f0-9]{64}$/.test(input.manifestRevision)) throw Error("Invalid manifest revision");
  if (!input.folders.includes(source)) throw Error("Source folder is unavailable");
  const parent = destination.includes("/") ? destination.slice(0, destination.lastIndexOf("/")) : "";
  if (parent && !input.folders.includes(parent)) throw Error("Destination parent is unavailable");
  if (input.folders.some(value => canonical(value) === canonical(destination)) || input.items.some(item => canonical(item.relativePath) === canonical(destination))) throw Error("Folder destination is occupied");
  const rebase = (value: string) => destination + value.slice(source.length);
  const folders = input.folders.filter(value => within(value, source)).map(value => ({ from: value, to: rebase(value) })).sort((a,b) => a.from.localeCompare(b.from));
  const items = input.items.filter(item => within(item.relativePath, source)).map(item => ({ ...item, destination: rebase(item.relativePath) })).sort((a,b) => a.itemId.localeCompare(b.itemId));
  // Descendant shares follow the same directory objects. Ancestor inheritance
  // is materialized on the moved root so moving out cannot remove access.
  const movedGrants = grants.filter(grant => within(grant.path, source)).map(grant => ({ ...grant, destination: rebase(grant.path) }));
  const sourceInherited = grants.filter(grant => grant.path !== source && within(source, grant.path));
  const retainedAccess = new Map<string, FolderMoveGrant>();
  for (const grant of [...sourceInherited, ...grants.filter(grant => grant.path === source)]) {
    const old = retainedAccess.get(grant.email);
    if (!old || rank[old.role] < rank[grant.role]) retainedAccess.set(grant.email, grant);
  }
  const preserveInherited = sourceInherited.filter(grant => retainedAccess.get(grant.email)?.id === grant.id)
    .map(grant => ({ ...grant, destination }));
  const addedAccess = grants.filter(grant => within(destination, grant.path) && !within(grant.path, source))
    .filter(grant => !retainedAccess.has(grant.email) || rank[retainedAccess.get(grant.email)!.role] < rank[grant.role])
    .map(grant => ({ email: grant.email, role: grant.role, via: grant.path }));
  const grantsFingerprint = createHash("sha256").update(JSON.stringify([...grants].sort((a,b) => a.id.localeCompare(b.id)))).digest("hex");
  return { source, destination, manifestRevision: input.manifestRevision, grantsFingerprint, folders, items, movedGrants, preserveInherited, addedAccess };
}

/** Bind approval and recovery to every planned file and access transition.
 * Object key order may change after PostgreSQL JSONB round-trips. */
export function folderMovePlanHash(plan: ReturnType<typeof planFolderMove>): string {
  const canonical = JSON.stringify(plan, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value);
  return createHash("sha256").update(canonical).digest("hex");
}
