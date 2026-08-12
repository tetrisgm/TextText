import { blogBaseUrl, locatedPostUrl, notFound } from "@/lib/agent-surface";
import { postBodyPreview, type Post } from "@/lib/content";
import { resolveCoverUrl } from "@/lib/cover";
import { getBlog, getPublicPostLocations } from "@/lib/store";
import type { PublicPostLocation } from "@/lib/store";
import { postSubtitle } from "@/lib/markdown-subtitle";

interface Props {
  params: Promise<{ handle: string }>;
}

const FALLBACK_DATE = new Date("1970-01-01T00:00:00.000Z");

export async function GET(_request: Request, { params }: Props) {
  const { handle } = await params;
  const blog = await getBlog(handle);
  if (!blog) return notFound();

  const locations = newestFirst(await getPublicPostLocations(handle));
  const posts = locations.map((location) => location.post);
  const baseUrl = blogBaseUrl(blog);
  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: blog.name,
    home_page_url: baseUrl,
    feed_url: `${baseUrl}/feed.json`,
    description: blog.tagline || undefined,
    authors: [{ name: blog.author }],
    language: "en",
    items: posts.map((post, index) => {
      const url = locatedPostUrl(baseUrl, locations[index]!);
      const summary = postSubtitle(post) || plainTextSummary(postBodyPreview(post));
      const image = resolveCoverUrl(post, baseUrl);

      return {
        id: url,
        url,
        title: post.title,
        ...(image ? { image } : {}),
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

function newestFirst(locations: PublicPostLocation[]): PublicPostLocation[] {
  return [...locations].sort((a, b) => {
    const byDate = postDate(b.post).getTime() - postDate(a.post).getTime();
    return byDate || a.post.slug.localeCompare(b.post.slug);
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
