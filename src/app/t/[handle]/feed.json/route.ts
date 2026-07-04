import type { Post } from "@/lib/content";
import { resolveCoverUrl } from "@/lib/cover";
import { getBlog, getPosts } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string }>;
}

const FALLBACK_ROOT_DOMAIN = "localhost:3000";
const FALLBACK_DATE = new Date("1970-01-01T00:00:00.000Z");

export async function GET(_request: Request, { params }: Props) {
  const { handle } = await params;
  const blog = await getBlog(handle);
  if (!blog) return notFound();

  const posts = newestFirst(await getPosts(handle));
  const baseUrl = blogBaseUrl(handle);
  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: blog.name,
    home_page_url: baseUrl,
    feed_url: `${baseUrl}/feed.json`,
    description: blog.tagline || undefined,
    authors: [{ name: blog.author }],
    language: "en",
    items: posts.map((post) => {
      const url = postUrl(baseUrl, post.slug);
      const summary = post.excerpt?.trim() || plainTextSummary(post.body);

      return {
        id: url,
        url,
        title: post.title,
        image: resolveCoverUrl(post, baseUrl),
        summary,
        content_text: summary,
        date_published: postDate(post).toISOString(),
        authors: [{ name: blog.author }],
      };
    }),
  };

  return new Response(JSON.stringify(feed, null, 2), {
    headers: {
      "Content-Type": "application/feed+json; charset=utf-8",
    },
  });
}

function newestFirst(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    const byDate = postDate(b).getTime() - postDate(a).getTime();
    return byDate || a.slug.localeCompare(b.slug);
  });
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

function plainTextSummary(markdown: string): string {
  const firstBlock =
    markdown
      .replace(/```[\s\S]*?```/g, " ")
      .split(/\n{2,}/)
      .map(stripMarkdown)
      .map((value) => value.trim())
      .find(Boolean) ?? "";

  return truncate(firstBlock, 280);
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

function blogBaseUrl(handle: string): string {
  const url = rootDomainUrl();
  url.hostname = `${handle}.${url.hostname}`;
  return url.origin;
}

function postUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/${encodeURIComponent(slug)}`;
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

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
