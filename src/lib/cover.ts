import type { Post } from "@/lib/content";
import { COVER_PILE } from "@/lib/cover-pile";

type CoverPost = Pick<Post, "cover" | "id" | "slug" | "title">;

export const NO_COVER_VALUE = "__write_no_cover__";

export function isNoCoverValue(value: string | null | undefined): boolean {
  return value?.trim() === NO_COVER_VALUE;
}

export function resolveCover(post: CoverPost): string {
  const cover = post.cover?.trim();
  if (isNoCoverValue(cover)) return "";
  if (cover) return cover;

  const fallback = COVER_PILE[stableHash(coverHashBasis(post)) % COVER_PILE.length];
  return fallback ?? COVER_PILE[0] ?? "";
}

export function resolveCoverUrl(post: CoverPost, baseUrl: string): string {
  const cover = resolveCover(post);
  return cover ? new URL(cover, baseUrl).toString() : "";
}

export function coverMimeType(src: string): string {
  const path = src.split(/[?#]/, 1)[0]?.toLowerCase() || "";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function coverHashBasis(post: CoverPost): string {
  return post.id?.trim() || post.slug.trim() || post.title.trim() || "untitled";
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
