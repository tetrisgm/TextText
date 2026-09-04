// What a list row and a palette result call an item's kind and its place.
//
// These two answers were written out inside the command palette, and the row
// needed the same ones for its chips. One definition, so a row and a search
// result can never disagree about what kind of thing you are looking at.

import { folderPathForPoolPost } from "@/lib/pool/selectors";
import type { WorkspacePoolPayload, WorkspacePoolPost } from "@/lib/pool/types";

export function itemKindLabel(type: WorkspacePoolPost["type"]): string {
  if (type === "note") return "Note";
  if (type === "bookmark") return "Bookmark";
  if (type === "media_post") return "Project";
  if (type === "video_post") return "Talk";
  return "Article";
}

export function itemFolderLabel(
  post: WorkspacePoolPost,
  pool: WorkspacePoolPayload,
): string {
  const path = folderPathForPoolPost(pool, post);
  const folder = pool.folders.find((candidate) => candidate.path === path);
  if (folder?.name.trim()) return folder.name.trim();
  return (
    path
      .split("/")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" / ") || "Library"
  );
}

/**
 * The one chip a row has earned, if any.
 *
 * The plan asked for item type and folder as chips before the title. Drawn
 * literally that is two chips on every row, and in a real workspace both
 * values repeat: twelve rows reading NOTE DOCUMENTATION is a wall of colour
 * that says nothing and pushes every title to the right. A chip earns its
 * place by being UNUSUAL - the row that is the article among notes, or the
 * one filed somewhere else - which is how the labels read in the screenshots
 * this came from. So: at most one chip, and only for a value that fewer than
 * half the visible rows share.
 */
export type ChipCensus = {
  kinds: Map<string, number>;
  folders: Map<string, number>;
  total: number;
};

export function chipCensus(
  posts: readonly WorkspacePoolPost[],
  pool: WorkspacePoolPayload,
): ChipCensus {
  const kinds = new Map<string, number>();
  const folders = new Map<string, number>();
  for (const post of posts) {
    const kind = itemKindLabel(post.type);
    const folder = itemFolderLabel(post, pool);
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  return { kinds, folders, total: posts.length };
}

export function chipForPost(
  post: WorkspacePoolPost,
  pool: WorkspacePoolPayload,
  census: ChipCensus,
): { label: string; kind: "type" | "folder" } | null {
  if (census.total < 3) return null;
  const majority = census.total / 2;
  const folder = itemFolderLabel(post, pool);
  const folderCount = census.folders.get(folder) ?? 0;
  const kind = itemKindLabel(post.type);
  const kindCount = census.kinds.get(kind) ?? 0;
  // Whichever is rarer, and only if it is actually rare. Folder wins a tie:
  // the row's icon already says what kind of thing it is.
  const folderEarns = folderCount < majority;
  const kindEarns = kindCount < majority;
  if (folderEarns && (!kindEarns || folderCount <= kindCount)) {
    return { label: folder, kind: "folder" };
  }
  if (kindEarns) return { label: kind, kind: "type" };
  return null;
}

/**
 * Changed recently enough to be worth a mark in the gutter.
 *
 * "Recently" is the last day. A list of things you touched this week would
 * mark every row, which is the same as marking none.
 */
export function changedRecently(
  post: WorkspacePoolPost,
  now = Date.now(),
): boolean {
  const stamp = post.updatedAt ? Date.parse(post.updatedAt) : Number.NaN;
  if (Number.isNaN(stamp)) return false;
  const age = now - stamp;
  return age >= 0 && age < 24 * 60 * 60 * 1000;
}
