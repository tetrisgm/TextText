import type { Blog, Post } from "@/lib/content";
import {
  workspacePublicBaseUrl,
  workspacePublicPostPath,
} from "@/lib/public-paths";
import type { PublicPostLocation } from "@/lib/store";

export function publishedNewestFirst(posts: Post[]): Post[] {
  return posts
    .filter((post) => post.status === "published")
    .sort((a, b) => {
      const aDate = postDate(a);
      const bDate = postDate(b);
      if (aDate && !bDate) return -1;
      if (!aDate && bDate) return 1;
      const byDate = (bDate?.getTime() ?? 0) - (aDate?.getTime() ?? 0);
      return byDate || a.slug.localeCompare(b.slug);
    });
}

export function blogBaseUrl(blog: Pick<Blog, "handle" | "username">): string {
  return workspacePublicBaseUrl(blog.handle);
}

export function locatedPostUrl(
  baseUrl: string,
  location: Pick<PublicPostLocation, "folderPath" | "post">,
): string {
  const path = workspacePublicPostPath(
    location.folderPath,
    location.post.slug,
  );
  return path ? `${baseUrl}${path}` : baseUrl;
}

export function locatedPostMarkdownUrl(
  baseUrl: string,
  location: Pick<PublicPostLocation, "folderPath" | "post">,
): string {
  return `${locatedPostUrl(baseUrl, location)}/index.md`;
}

export function postUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/blog/${encodeURIComponent(slug)}`;
}

export function postMarkdownUrl(baseUrl: string, slug: string): string {
  return `${postUrl(baseUrl, slug)}/index.md`;
}

export function postsJsonUrl(baseUrl: string): string {
  return `${baseUrl}/posts.json`;
}

export function folderJsonUrl(baseUrl: string): string {
  return `${baseUrl}/folder.json`;
}

export function llmsTxtUrl(baseUrl: string): string {
  return `${baseUrl}/llms.txt`;
}

export function postIsoDate(post: Post): string | null {
  return postDate(post)?.toISOString().slice(0, 10) ?? null;
}

export function plainTextSummary(markdown: string): string {
  const firstBlock =
    markdown
      .replace(/```[\s\S]*?```/g, " ")
      .split(/\n{2,}/)
      .map(stripMarkdown)
      .map((value) => value.trim())
      .find(Boolean) ?? "";

  return truncate(oneLine(firstBlock), 280);
}

export function oneLine(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function markdownLinkText(value: string): string {
  return oneLine(value).replace(/([\\[\]])/g, "\\$1");
}

export function pipeDelimitedValue(value: string): string {
  return value.replace(/\|+/g, "/");
}

export function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

function postDate(post: Post): Date | null {
  return parseDate(post.date);
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
