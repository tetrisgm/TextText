// The bridge is document-global. A workspace can change only by replacing the
// document, so delayed callbacks can never inherit another workspace's transport.
let owner: { workspaceId: string; name: string } | null = null;
export function claimWebSession(workspaceId: string, name: string) {
  if (!owner) owner = { workspaceId, name };
  return owner;
}
export function renameWebSession(workspaceId: string, name: string) {
  if (!owner || owner.workspaceId !== workspaceId || owner.name === name) return false;
  owner.name = name;
  return true;
}
