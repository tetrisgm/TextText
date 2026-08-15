import type { Post } from "@/lib/content";

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

  // A document with no picture has no picture.
  //
  // This used to hand any post without a cover a stock photograph from a pile,
  // chosen by hashing the post - so an article about a handheld console led
  // with a picture of a road. It is decoration presented as content: the index
  // shows a cover the post does not have, and opening it finds nothing of the
  // kind. Nothing a look does can correct for it, because the look is being
  // handed an image that was invented for it.
  return { kind: "none", src: "" };
}

export function resolveCover(post: CoverPost): string {
  return resolveCoverSource(post).src;
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


function bookmarkCaptureCover(post: CoverPost): CoverSource | null {
  if (post.type !== "bookmark") return null;
  const asset = post.capture?.assets?.find((candidate) =>
    isHttpUrl(candidate.url?.trim()),
  );
  if (asset?.url) {
    return { kind: "bookmark-body-image", src: asset.url.trim() };
  }

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

