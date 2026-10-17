import { sharedFileHref, sharedFolderHref, sharedWorkspaceHref } from "./shared-vaults";

type ShareTarget = { workspaceId: string; scopeType: "item" | "folder"; scopeKey: string };

/** A private workspace link uses its authenticated web address, never the
 * packaged WebView's file or synthetic origin. This does not grant access. */
export function workspaceShareLink(target: ShareTarget, workspaceURL: string | null | undefined): string | null {
  if (!workspaceURL) return null;
  try {
    const site = new URL(workspaceURL);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname);
    if (site.username || site.password || site.hostname === "texttext.local" ||
        !(site.protocol === "https:" || site.protocol === "http:" && loopback) ||
        site.pathname.replace(/\/$/, "") !== sharedWorkspaceHref(target.workspaceId)) return null;
    const relative = target.scopeType === "item"
      ? sharedFileHref(target.workspaceId, target.scopeKey)
      : sharedFolderHref(target.workspaceId, target.scopeKey);
    return new URL(relative, site.origin).href;
  } catch { return null; }
}
