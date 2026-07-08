import type { Post } from "@/lib/content";
import { COVER_PILE } from "@/lib/cover-pile";

type CoverPost = Pick<
  Post,
  "body" | "capture" | "cover" | "id" | "links" | "slug" | "title" | "type"
>;

export const NO_COVER_VALUE = "__write_no_cover__";

export type CoverSourceKind =
  | "none"
  | "explicit"
  | "fallback"
  | "bookmark-body-image"
  | "bookmark-screenshot"
  | "bookmark-favicon";

export type CoverSource = {
  kind: CoverSourceKind;
  src: string;
};

export function isNoCoverValue(value: string | null | undefined): boolean {
  return value?.trim() === NO_COVER_VALUE;
}

export function resolveCoverSource(post: CoverPost): CoverSource {
  const cover = post.cover?.trim();
  if (isNoCoverValue(cover)) return { kind: "none", src: "" };
  if (cover) return { kind: "explicit", src: cover };

  const captureCover = bookmarkCaptureCover(post);
  if (captureCover) return captureCover;

  if (post.type === "bookmark") return { kind: "none", src: "" };

  const fallback =
    COVER_PILE[stableHash(coverHashBasis(post)) % COVER_PILE.length];
  return { kind: "fallback", src: fallback ?? COVER_PILE[0] ?? "" };
}

export function resolveCover(post: CoverPost): string {
  return resolveCoverSource(post).src;
}

export function usesBookmarkCaptureCover(post: CoverPost): boolean {
  return resolveCoverSource(post).kind === "bookmark-screenshot";
}

export function usesBookmarkFaviconCover(post: CoverPost): boolean {
  return resolveCoverSource(post).kind === "bookmark-favicon";
}

export function firstHttpMarkdownImage(markdown: string | undefined): string {
  const body = markdown ?? "";
  const imagePattern =
    /!\[[^\]]*]\(\s*<?(https?:\/\/[^\s<>)]+)>?(?:\s+["'][^)]*["'])?\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = imagePattern.exec(body))) {
    const src = match[1]?.trim();
    if (isHttpUrl(src)) return src;
  }
  return "";
}

export function bookmarkFaviconUrl(post: CoverPost): string {
  const sourceUrl = bookmarkSourceUrl(post);
  if (!sourceUrl) return "";
  try {
    const url = new URL(sourceUrl);
    return `https://${url.host}/favicon.ico`;
  } catch {
    return "";
  }
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
  if (path.endsWith(".ico")) return "image/x-icon";
  return "image/jpeg";
}

function coverHashBasis(post: CoverPost): string {
  return post.id?.trim() || post.slug.trim() || post.title.trim() || "untitled";
}

function bookmarkCaptureCover(post: CoverPost): CoverSource | null {
  if (post.type !== "bookmark") return null;
  const bodyImage = firstHttpMarkdownImage(post.body);
  if (bodyImage) return { kind: "bookmark-body-image", src: bodyImage };

  const screenshot = post.capture?.screenshotUrl?.trim();
  if (screenshot && isHttpUrl(screenshot)) {
    return { kind: "bookmark-screenshot", src: screenshot };
  }

  const favicon = bookmarkFaviconUrl(post);
  if (favicon) return { kind: "bookmark-favicon", src: favicon };

  return null;
}

function bookmarkSourceUrl(post: CoverPost): string {
  const captureUrl = post.capture?.url?.trim();
  if (isHttpUrl(captureUrl)) return captureUrl;
  const linkUrl = post.links?.[0]?.href?.trim();
  if (isHttpUrl(linkUrl)) return linkUrl;
  return "";
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
