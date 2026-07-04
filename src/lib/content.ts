// Shared content types + pure helpers for the reader. Helpers are hand-rolled
// (no Intl/Date) so they render identically on server and client with no
// timezone drift on the day.

export interface Blog {
  handle: string;
  name: string;
  author: string;
  tagline?: string;
  /** hex accent for the blog; posts may override */
  accent?: string;
  /** one-line standing profile bio */
  bioLine?: string;
  cardStyle: BlogCardStyle;
  homeLayout: BlogHomeLayout;
}

export type BlogCardStyle = "cover" | "minimal";
export type BlogHomeLayout = "cards" | "timeline";
export type PostType = "article" | "project" | "talk";

export interface GalleryItem {
  /** image or video URL */
  src: string;
  caption?: string;
  /** optional poster image for video URLs */
  poster?: string;
}

export interface LinkRef {
  label: string;
  href: string;
}

export interface Post {
  /** opaque database id; absent for demo/seed content and unsaved drafts */
  id?: string;
  type: PostType;
  slug: string;
  title: string;
  /** short dek/standfirst shown under the title */
  excerpt?: string;
  /** hex accent; empty string opts out of the blog accent */
  accent?: string;
  cover?: string;
  coverCaption?: string;
  /** markdown body */
  body: string;
  /** ISO date, e.g. "2026-07-01" */
  date?: string;
  status: "draft" | "published";
  /** owner-curated placement at the top of public and owner lists */
  pinned?: boolean;
  gallery?: GalleryItem[];
  links?: LinkRef[];
  videoUrl?: string;
  venue?: string;
  duration?: string;
}

const VIDEO_FILE_RE = /\.(mp4|webm|mov|m4v|ogv|ogg)(?:[?#].*)?$/i;
const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_FALLBACK_RE =
  /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function normalizedUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    try {
      return new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }
}

function youtubeVideoId(url: string | undefined): string | undefined {
  if (!url) return undefined;

  const parsed = normalizedUrl(url);
  if (parsed) {
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const parts = parsed.pathname.split("/").filter(Boolean);
    let id: string | null = null;

    if (hostname === "youtu.be") {
      id = parts[0] ?? null;
    } else if (
      hostname === "youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "youtube-nocookie.com"
    ) {
      if (parts[0] === "watch") id = parsed.searchParams.get("v");
      if (["embed", "shorts", "live"].includes(parts[0] ?? "")) {
        id = parts[1] ?? null;
      }
    }

    if (id && YOUTUBE_ID_RE.test(id)) return id;
  }

  const match = url.match(YOUTUBE_FALLBACK_RE);
  return match?.[1] && YOUTUBE_ID_RE.test(match[1]) ? match[1] : undefined;
}

export function isYouTube(url: string | undefined): boolean {
  return youtubeVideoId(url) !== undefined;
}

export function youtubeEmbedUrl(url: string): string | undefined {
  const id = youtubeVideoId(url);
  if (!id) return undefined;
  return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`;
}

export function youtubeThumb(url: string | undefined): string | undefined {
  const id = youtubeVideoId(url);
  if (!id) return undefined;
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

export function isVideoFile(url: string | undefined): boolean {
  return !!url && VIDEO_FILE_RE.test(url);
}

/** "2026-06-25" -> "June 25, 2026"; bare years and unparseable values pass through. */
export function formatArticleDate(date: string | undefined): string {
  if (!date) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const mi = Number(m[2]) - 1;
  if (mi < 0 || mi > 11) return date;
  return `${MONTHS[mi]} ${Number(m[3])}, ${m[1]}`;
}

/** Reading time in whole minutes at ~200 wpm, floored at 1. */
export function readingTimeMin(body: string | undefined): number {
  const words = body ? (body.trim().match(/\S+/g) || []).length : 0;
  return Math.max(1, Math.round(words / 200));
}

/** The accent a post renders with: its own, else the blog's, else none. */
export function postAccent(blog: Blog, post: Post): string | undefined {
  if (post.accent !== undefined) {
    const accent = post.accent.trim();
    return accent || undefined;
  }
  return blog.accent || undefined;
}

/** Uppercase first letter for monogram avatars. */
export function monogram(name: string): string {
  return (name.trim()[0] || "W").toUpperCase();
}
