import type { Post } from "@/lib/content";

const FALLBACK_ROOT_DOMAIN = "localhost:3000";
const FALLBACK_DATE = new Date("1970-01-01T00:00:00.000Z");

export function publishedNewestFirst(posts: Post[]): Post[] {
  return posts
    .filter((post) => post.status === "published")
    .sort((a, b) => {
      const byDate = postDate(b).getTime() - postDate(a).getTime();
      return byDate || a.slug.localeCompare(b.slug);
    });
}

export function blogBaseUrl(handle: string): string {
  const url = rootDomainUrl();
  url.hostname = `${handle}.${url.hostname}`;
  return url.origin;
}

export function postUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/${encodeURIComponent(slug)}`;
}

export function postMarkdownUrl(baseUrl: string, slug: string): string {
  return `${postUrl(baseUrl, slug)}/index.md`;
}

export function postsJsonUrl(baseUrl: string): string {
  return `${baseUrl}/posts.json`;
}

export function llmsTxtUrl(baseUrl: string): string {
  return `${baseUrl}/llms.txt`;
}

export function postIsoDate(post: Post): string {
  return postDate(post).toISOString().slice(0, 10);
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

export function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

function postDate(post: Post): Date {
  return parseDate(post.date) ?? FALLBACK_DATE;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function rootDomainUrl(): URL {
  const rawDomain = (
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ||
    process.env.ROOT_DOMAIN ||
    FALLBACK_ROOT_DOMAIN
  )
    .trim()
    .replace(/\/+$/, "");
  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(rawDomain)
    ? rawDomain
    : `${isLocalDomain(rawDomain) ? "http" : "https"}://${rawDomain}`;

  try {
    return new URL(candidate);
  } catch {
    return new URL(`http://${FALLBACK_ROOT_DOMAIN}`);
  }
}

function isLocalDomain(value: string): boolean {
  const host = value.split("/")[0]?.split(":")[0]?.toLowerCase() || "";
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1";
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
