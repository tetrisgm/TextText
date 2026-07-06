import { blogBaseUrl, notFound, postUrl } from "@/lib/agent-surface";
import type { Blog, Post } from "@/lib/content";
import { coverMimeType, resolveCoverUrl } from "@/lib/cover";
import { getBlog, getPosts } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string }>;
}

const FALLBACK_DATE = new Date("1970-01-01T00:00:00.000Z");

export async function GET(_request: Request, { params }: Props) {
  const { handle } = await params;
  const blog = await getBlog(handle);
  if (!blog) return notFound();

  const posts = newestFirst(await getPosts(handle));
  const baseUrl = blogBaseUrl(blog);
  const feedUrl = `${baseUrl}/feed.xml`;

  return new Response(renderRss(blog, posts, baseUrl, feedUrl), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
}

function renderRss(
  blog: Blog,
  posts: Post[],
  baseUrl: string,
  feedUrl: string,
): string {
  const description = blog.tagline || blog.name;
  const lastBuildDate = feedDate(posts).toUTCString();
  const items = posts
    .map((post) => {
      const url = postUrl(baseUrl, post.slug);
      const published = postDate(post).toUTCString();
      const summary = post.excerpt?.trim() || plainTextSummary(post.body);
      const imageUrl = resolveCoverUrl(post, baseUrl);
      const mediaContent = imageUrl
        ? `      <media:content url="${escapeXml(imageUrl)}" medium="image" type="${escapeXml(coverMimeType(imageUrl))}" />`
        : "";

      return [
        "    <item>",
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        `      <pubDate>${escapeXml(published)}</pubDate>`,
        mediaContent,
        `      <description>${escapeXml(summary)}</description>`,
        `      <dc:creator>${escapeXml(blog.author)}</dc:creator>`,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">',
    "  <channel>",
    `    <title>${escapeXml(blog.name)}</title>`,
    `    <link>${escapeXml(baseUrl)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    `    <dc:creator>${escapeXml(blog.author)}</dc:creator>`,
    `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />`,
    "    <language>en</language>",
    `    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>`,
    "    <generator>Write</generator>",
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

function newestFirst(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    const byDate = postDate(b).getTime() - postDate(a).getTime();
    return byDate || a.slug.localeCompare(b.slug);
  });
}

function feedDate(posts: Post[]): Date {
  return posts[0] ? postDate(posts[0]) : FALLBACK_DATE;
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

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
