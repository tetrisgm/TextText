import type { WorkspacePoolPost } from "@/lib/pool/types";

/** Presentation identifies authored writing; source membership remains independent. */
export function writingKind(post: Pick<WorkspacePoolPost, "origin" | "type" | "template">): "note" | "article" | "custom" | null {
  if (post.origin === "feed" || post.type === "bookmark") return null;
  if (post.template?.id === "texttext.article") return "article";
  if (post.template?.id === "texttext.note") return "note";
  if (post.template) return "custom";
  return post.type === "article" ? "article" : post.type === "note" ? "note" : "custom";
}
