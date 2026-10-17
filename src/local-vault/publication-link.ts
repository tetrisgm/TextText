import { workspaceShareLink } from "./workspace-share-link";

type PublicationLinkState = { itemId: string; publicPath: string; publicURL?: string };

/** Public reading keeps its own route and never uses a packaged page's origin. */
export function publicationLink(state: PublicationLinkState, workspaceId: string, workspaceURL?: string | null): string {
  const expected = `/v/${encodeURIComponent(workspaceId)}/${encodeURIComponent(state.itemId)}`;
  if (state.publicPath !== expected) return "";
  try {
    const supplied = state.publicURL === undefined ? null : new URL(state.publicURL);
    if (supplied && (supplied.pathname !== expected || supplied.username || supplied.password || supplied.search || supplied.hash)) return "";
    const workspace = supplied ? new URL(`/vault/${encodeURIComponent(workspaceId)}`, supplied.origin).href : workspaceURL;
    const verified = workspaceShareLink({ workspaceId, scopeType: "item", scopeKey: state.itemId }, workspace);
    return verified ? new URL(expected, new URL(verified).origin).href : "";
  } catch { return ""; }
}
