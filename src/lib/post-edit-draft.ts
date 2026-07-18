import type { GalleryItem, Post } from "@/lib/content";
import { normalizeTags } from "@/lib/tags";
import {
  ensureMarkdownSubtitle,
  markdownSubtitle,
} from "@/lib/markdown-subtitle";

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
  tags: string[];
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
  const body = ensureMarkdownSubtitle(
    post.body,
    post.excerpt,
    post.type === "article",
  );
  return {
    type: post.type,
    title:
      isUnsetTitle(post.title) && isPlaceholderSlug(post.slug)
        ? ""
        : post.title,
    excerpt: markdownSubtitle(body),
    cover: post.cover ?? "",
    coverCaption: post.coverCaption ?? "",
    coverHeight: post.coverHeight ?? null,
    body,
    status: post.status,
    slug: post.slug,
    accent: post.accent ?? "",
    gallery: post.gallery ?? [],
    tags: normalizeTags(post.tags),
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

export function payloadFor(
  id: string,
  draft: DraftState,
  fallbackSlug: string,
  baseUpdatedAt?: string,
) {
  return {
    id,
    type: draft.type,
    title: draft.title,
    // Kept in the legacy column as a derived cache for older clients. Markdown
    // remains the only authored source.
    excerpt: markdownSubtitle(draft.body),
    cover: draft.cover || null,
    coverCaption: draft.coverCaption || null,
    coverHeight: draft.coverHeight,
    body: draft.body,
    status: draft.status,
    slug: slugify(draft.slug, fallbackSlug),
    accent: draft.accent || null,
    gallery: draft.gallery,
    tags: normalizeTags(draft.tags),
    videoUrl: draft.videoUrl || null,
    venue: draft.venue || null,
    duration: draft.duration || null,
    date: draft.date || null,
    baseUpdatedAt: baseUpdatedAt || null,
  };
}

export function payloadKey(payload: ReturnType<typeof payloadFor>): string {
  const { baseUpdatedAt, ...content } = payload;
  void baseUpdatedAt;
  return JSON.stringify(content);
}
