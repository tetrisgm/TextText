import type { LocalWorkspaceView } from "./local-view";

/** Destinations keep independent positions; reading and editing share an item. */
export function viewScrollMemoryKey(view: LocalWorkspaceView, homePane: string): string {
  if (view.level === "post" || view.level === "edit") return `item:${view.postId}`;
  if (view.level === "root") return `root:${homePane}`;
  if (view.level === "search") return `search:${view.source}:${view.query}`;
  if (view.level === "settings") return "settings";
  return `${view.level}:${view.folderPath}`;
}
