// Shared content types + pure helpers for the reader. Helpers are hand-rolled
// (no Intl/Date) so they render identically on server and client with no
// timezone drift on the day.

export interface Blog {
  handle: string;
  username?: string;
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
export type BlogHomeLayout = "single" | "timeline" | "grid" | "index";
export const FILE_REPRESENTATIONS = ["textbundle", "markdown", "text"] as const;
export type FileRepresentation = (typeof FILE_REPRESENTATIONS)[number];
// A post syncs as a single flat `<title>.md` file, NOT a `.textbundle` package.
// A package's directory name and its inner text.md reconcile on separate File
// Provider schedules, so a server rename could leave {content: new, dirname:
// old} and the framework would push the stale name back, silently reverting the
// rename in a loop (the "phantom rename"). A flat .md is one inode: filename and
// content are two version fields of the SAME node and move together, so that
// split state cannot exist and the phantom is structurally impossible. Images
// resolve from the shared Data/Attachments tree. `textbundle` stays in the enum
// for legacy/interchange reads only.
export const DEFAULT_FILE_REPRESENTATION: FileRepresentation = "markdown";

export function isFileRepresentation(
  value: string | null | undefined,
): value is FileRepresentation {
  return FILE_REPRESENTATIONS.some((representation) => representation === value);
}

/**
 * article/project/talk are the Blog folder's public kinds; note and bookmark
 * belong to the Notes and Bookmarks folders and are always unlisted.
 */
export type PostType = "article" | "project" | "talk" | "note" | "bookmark";
export type BlogPostType = "article" | "project" | "talk";

// Product surfaces share the same lower-level content/media/permission
// primitives, but remain distinct user-facing jobs.
export type Surface = "blog" | "notes" | "bookmarks" | "feeds" | "group";

/** How a folder renders and edits its items. */
export type FolderMode = "blog" | "notes" | "bookmarks";
export const BLOG_FOLDER_PATH = "blog";
export const PRIVATE_POST_TYPES = ["note", "bookmark"] as const;
export type PrivatePostType = (typeof PRIVATE_POST_TYPES)[number];

export function isPrivatePostType(
  type: string | null | undefined,
): type is PrivatePostType {
  return type === "note" || type === "bookmark";
}

export function isPrivateFolderMode(
  mode: string | null | undefined,
): mode is Extract<FolderMode, "notes" | "bookmarks"> {
  return mode === "notes" || mode === "bookmarks";
}

export function isBlogBucketPath(path: string): boolean {
  return path === BLOG_FOLDER_PATH || path.startsWith(`${BLOG_FOLDER_PATH}/`);
}

export interface Folder {
  id: string;
  name: string;
  /**
   * Full URL-safe relative path inside the workspace, e.g. "blog" or
   * "blog/ideas". Subfolders carry their whole ancestry in the path; the
   * sync tree and manifests mirror it directly as directories.
   */
  path: string;
  mode: FolderMode;
  position: number;
  /** null/absent for the three system roots; the parent folder id below them */
  parentId?: string | null;
}
export type ItemKind =
  | "article"
  | "media_post"
  | "video_post"
  | "note"
  | "bookmark"
  | "feed_item"
  | "group_post";

/**
 * Everything a completed bookmark capture produced. Binary artifacts live in
 * Blob storage (URLs here); the readable extraction lives in the post body
 * itself so the Markdown file round-trips it. Native Write documents package
 * these artifacts inside their TextBundle; imported plain files address them
 * through the single root Data/Attachments tree.
 */
export type BookmarkCapture = {
  /** the captured page URL (may differ from the requested URL via redirects) */
  url: string;
  title?: string;
  siteName?: string;
  description?: string;
  /** Blob URL of the full-page screenshot (PNG) */
  screenshotUrl?: string;
  /** Ordered full-page screenshot tiles for pages taller than one safe image. */
  screenshotTiles?: BookmarkCaptureScreenshotTile[];
  /** locally stored inline assets from the readable extraction */
  assets?: BookmarkCaptureAsset[];
  /** ISO timestamp of the capture */
  capturedAt?: string;
  /** "server" (light fetch) | "mac" (full capture agent) */
  capturedBy?: string;
  /** why captureStatus is "failed", when it is */
  error?: string;
};

export type BookmarkCaptureScreenshotTile = {
  index: number;
  url: string;
};

export type BookmarkCaptureAsset = {
  /** original remote image URL seen in the captured page */
  originalUrl: string;
  /** Blob URL served by Write */
  url: string;
  contentType?: string;
  filename?: string;
};

export type CaptureStatus = "pending" | "captured" | "failed";

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
  /** immutable Finder/on-disk representation; persisted posts always have one */
  representation?: FileRepresentation;
  type: PostType;
  /** bookmark capture pipeline state; only bookmarks ever set these */
  captureStatus?: CaptureStatus;
  capture?: BookmarkCapture;
  slug: string;
  title: string;
  /** short dek/standfirst shown under the title */
  excerpt?: string;
  /** hex accent; empty string opts out of the blog accent */
  accent?: string;
  cover?: string;
  coverCaption?: string;
  /** user-selected article header height in pixels */
  coverHeight?: number;
  /** markdown body */
  body: string;
  /** short body-derived preview for list reads that do not load full markdown */
  bodyPreview?: string;
  /** cached count of body tokens; used when list reads omit full markdown */
  wordCount?: number;
  /** cached or derived whole-minute reading time */
  readingTime?: number;
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
  /** owning folder id; absent for demo/seed content until folders backfill */
  folderId?: string;
  /** full ISO timestamps for sync/conflict detection; absent on demo content */
  createdAt?: string;
  updatedAt?: string;
  /**
   * Monotonic per-mutation version from the DB `write_change_seq` sequence.
   * The sync layer uses it as the compare-and-swap token: a write carries the
   * revision it read, and the store only lands if the row still holds it.
   * Absent for demo/seed content (no database).
   */
  revision?: number;
}

/**
 * Whether a user-supplied link href is safe to render as a clickable link:
 * web URLs, mail links, and in-site references only. Rejects javascript:,
 * data:, and every other scheme.
 */
export function isSafeLinkHref(value: string): boolean {
  const href = value.trim();
  if (!href) return false;
  if (href.startsWith("/") || href.startsWith("#")) return true;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href)?.[1]?.toLowerCase();
  if (!scheme) return true; // schemeless relative reference
  return scheme === "http" || scheme === "https" || scheme === "mailto";
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

/**
 * "2026-06-25" -> "June 25, 2026" (long, the default) or "Jun 25, 2026"
 * (short); bare years and unparseable values pass through.
 */
export function formatArticleDate(
  date: string | undefined,
  options?: { style?: "long" | "short" },
): string {
  if (!date) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const mi = Number(m[2]) - 1;
  if (mi < 0 || mi > 11) return date;
  const month =
    options?.style === "short" ? MONTHS[mi].slice(0, 3) : MONTHS[mi];
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

export function wordCountForMarkdown(body: string | undefined): number {
  return body ? (body.trim().match(/\S+/g) || []).length : 0;
}

export function readingTimeMinForWordCount(wordCount: number | undefined): number {
  return Math.max(1, Math.round((wordCount ?? 0) / 200));
}

/** Reading time in whole minutes at ~200 wpm, floored at 1. */
export function readingTimeMin(body: string | undefined): number {
  return readingTimeMinForWordCount(wordCountForMarkdown(body));
}

export function postReadingTimeMin(
  post: Pick<Post, "body" | "readingTime" | "wordCount">,
): number {
  if (typeof post.readingTime === "number") return Math.max(1, post.readingTime);
  if (typeof post.wordCount === "number") {
    return readingTimeMinForWordCount(post.wordCount);
  }
  return readingTimeMin(post.body);
}

export function postBodyPreview(
  post: Pick<Post, "body" | "bodyPreview">,
): string {
  return post.bodyPreview ?? post.body;
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
