import type { Blog, Post } from "@/lib/content";
import { isPrivatePostType, isSafeLinkHref } from "@/lib/content";
import { blogPostPath } from "@/lib/public-paths";
import { resolvePostSlug, type PostSlugResolution } from "@/lib/store";
import {
  splitWikiLinkText,
  type WikiLinkReference,
} from "@/lib/wikilink-syntax";

export type { WikiLinkReference } from "@/lib/wikilink-syntax";

export type WikiLinkRenderTarget = {
  slug: string;
  href: string;
};

export type WikiLinkRenderTargets = Record<string, WikiLinkRenderTarget>;

function fenceMarker(
  line: string,
): { marker: "`" | "~"; length: number; rest: string } | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  return {
    marker: match[1]![0] as "`" | "~",
    length: match[1]!.length,
    rest: match[2] ?? "",
  };
}

function inlineTextWithoutCode(line: string): string[] {
  const text: string[] = [];
  let start = 0;
  let cursor = 0;
  while (cursor < line.length) {
    if (line[cursor] !== "`") {
      cursor += 1;
      continue;
    }
    let runEnd = cursor + 1;
    while (line[runEnd] === "`") runEnd += 1;
    const marker = line.slice(cursor, runEnd);
    const close = line.indexOf(marker, runEnd);
    if (close < 0) {
      cursor = runEnd;
      continue;
    }
    text.push(line.slice(start, cursor));
    cursor = close + marker.length;
    start = cursor;
  }
  text.push(line.slice(start));
  return text;
}

/** Extract links from prose only. Fenced and inline code stay literal. */
export function extractWikiLinks(markdown: string): WikiLinkReference[] {
  const links: WikiLinkReference[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const marker = fenceMarker(line);
    if (fence) {
      if (
        marker?.marker === fence.marker &&
        marker.length >= fence.length &&
        !marker.rest.trim()
      ) {
        fence = null;
      }
      continue;
    }
    if (marker) {
      fence = { marker: marker.marker, length: marker.length };
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) continue;
    for (const prose of inlineTextWithoutCode(line)) {
      for (const part of splitWikiLinkText(prose)) {
        if (part.kind === "wikilink") {
          links.push({ target: part.target, label: part.label });
        }
      }
    }
  }
  return links;
}

export type WikiLinkTargetResolution =
  | { kind: "exact" | "history"; target: string; post: Post }
  | { kind: "tombstone" | "ambiguous" | "missing"; target: string };

/** Resolve a slug through the store, including its historical aliases. */
export async function resolveTarget(
  handle: string,
  slug: string,
): Promise<WikiLinkTargetResolution> {
  const resolution: PostSlugResolution = await resolvePostSlug(handle, slug);
  if (resolution.kind === "exact" || resolution.kind === "history") {
    return { kind: resolution.kind, target: slug, post: resolution.post };
  }
  return { kind: resolution.kind, target: slug };
}

/**
 * Turn a resolution into the only target data the renderer may receive.
 * Public readers fail closed for notes, bookmarks, drafts, and failed aliases.
 */
export function renderTargetForResolution(
  blog: Pick<Blog, "handle" | "username">,
  resolution: WikiLinkTargetResolution,
  options: { includePrivate?: boolean } = {},
): WikiLinkRenderTarget | null {
  if (resolution.kind !== "exact" && resolution.kind !== "history") return null;
  if (
    !options.includePrivate &&
    (resolution.post.status !== "published" ||
      isPrivatePostType(resolution.post.type))
  ) {
    return null;
  }
  const href = blogPostPath(blog, resolution.post);
  if (!isSafeLinkHref(href)) return null;
  return { slug: resolution.post.slug, href };
}

/**
 * Render targets for the public reader, built from an already-public post
 * list (the published feed). Fails closed: only published, public,
 * non-private-type posts become links, and aliases resolve only when their
 * current slug is itself public.
 */
export function publicWikiLinkRenderTargets({
  blog,
  posts,
  slugAliases = {},
}: {
  blog: Pick<Blog, "handle" | "username">;
  posts: Post[];
  slugAliases?: Record<string, string>;
}): WikiLinkRenderTargets {
  const targets: WikiLinkRenderTargets = {};
  for (const post of posts) {
    if (post.status !== "published") continue;
    if (post.visibility !== "public") continue;
    if (isPrivatePostType(post.type)) continue;
    const href = blogPostPath(blog, post);
    if (!isSafeLinkHref(href)) continue;
    targets[post.slug] = { slug: post.slug, href };
  }
  for (const [alias, currentSlug] of Object.entries(slugAliases)) {
    const target = targets[currentSlug];
    if (target && !targets[alias]) targets[alias] = target;
  }
  return targets;
}
