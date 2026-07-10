import type { GalleryItem, Post } from "@/lib/content";

export type DraftState = {
  type: Post["type"];
  title: string;
  excerpt: string;
  cover: string;
  coverCaption: string;
  coverHeight: number | null;
  body: string;
  status: Post["status"];
  slug: string;
  accent: string;
  gallery: GalleryItem[];
  videoUrl: string;
  venue: string;
  duration: string;
  date: string;
};

export type SaveState = "saved" | "saving" | "error";

export function isUnsetTitle(value: string): boolean {
  const normalized = value.trim();
  return normalized === "" || normalized.toLowerCase() === "untitled";
}

export function initialDraft(post: Post): DraftState {
  return {
    type: post.type,
    title: isUnsetTitle(post.title) ? "" : post.title,
    excerpt: post.excerpt ?? "",
    cover: post.cover ?? "",
    coverCaption: post.coverCaption ?? "",
    coverHeight: post.coverHeight ?? null,
    body: post.body,
    status: post.status,
    slug: post.slug,
    accent: post.accent ?? "",
    gallery: post.gallery ?? [],
    videoUrl: post.videoUrl ?? "",
    venue: post.venue ?? "",
    duration: post.duration ?? "",
    date: post.date ?? "",
  };
}

export function isHexColor(value: string | undefined): value is string {
  return Boolean(value && /^#[0-9a-fA-F]{6}$/.test(value));
}

export function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function isPlaceholderSlug(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  return normalized === "" || normalized.startsWith("untitled-");
}

export function uniqueSlug(base: string, usedSlugs: readonly string[]): string {
  const used = new Set(usedSlugs);
  if (!used.has(base)) return base;

  for (let index = 2; index < 100; index += 1) {
    const suffix = `-${index}`;
    const root = base.slice(0, 80 - suffix.length).replace(/-+$/g, "");
    const candidate = `${root || "post"}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }

  const suffix = `-${Date.now().toString(36)}`;
  const root = base.slice(0, 80 - suffix.length).replace(/-+$/g, "");
  return `${root || "post"}${suffix}`;
}

export function postPath(handle: string, slug: string): string {
  return `/t/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`;
}

export function payloadFor(id: string, draft: DraftState, fallbackSlug: string) {
  return {
    id,
    type: draft.type,
    title: draft.title,
    excerpt: draft.excerpt,
    cover: draft.cover || null,
    coverCaption: draft.coverCaption || null,
    coverHeight: draft.coverHeight,
    body: draft.body,
    status: draft.status,
    slug: slugify(draft.slug, fallbackSlug),
    accent: draft.accent || null,
    gallery: draft.gallery,
    videoUrl: draft.videoUrl || null,
    venue: draft.venue || null,
    duration: draft.duration || null,
    date: draft.date || null,
  };
}

export function payloadKey(payload: ReturnType<typeof payloadFor>): string {
  return JSON.stringify(payload);
}
