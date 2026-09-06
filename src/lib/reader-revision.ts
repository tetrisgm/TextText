import type { Post } from "@/lib/content";

export function readerRevision(post: Pick<Post, "revision" | "updatedAt">): string {
  return `${post.revision ?? ""}:${post.updatedAt ?? ""}`;
}
