import type { WorkspacePoolPost, WorkspaceReadingSource } from "@/lib/pool/types";

/**
 * Unread per folder path, rolled up so a parent that contains feed folders
 * shows the sum of what is under it. Pure and cheap: sources are one row per
 * feed, never per article.
 */
export function readingUnreadByFolder(sources: WorkspaceReadingSource[] | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  if (!sources) return result;
  for (const source of sources) {
    if (source.state === "detached" || !source.unread) continue;
    const parts = source.folderPath.split("/");
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const path = parts.slice(0, depth).join("/");
      result[path] = (result[path] ?? 0) + source.unread;
    }
  }
  return result;
}

export type { WorkspacePoolPost };
