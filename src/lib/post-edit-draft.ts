import type { Post } from "@/lib/content";

export type DraftState = {
  title: string;
  excerpt: string;
  body: string;
  status: Post["status"];
  slug: string;
  accent: string;
};

export type SaveState = "saved" | "saving" | "error";

export function initialDraft(post: Post): DraftState {
  return {
    title: post.title,
    excerpt: post.excerpt ?? "",
    body: post.body,
    status: post.status,
    slug: post.slug,
    accent: post.accent ?? "",
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
    title: draft.title,
    excerpt: draft.excerpt,
    body: draft.body,
    status: draft.status,
    slug: slugify(draft.slug, fallbackSlug),
    accent: draft.accent || null,
  };
}

export function payloadKey(payload: ReturnType<typeof payloadFor>): string {
  return JSON.stringify(payload);
}
