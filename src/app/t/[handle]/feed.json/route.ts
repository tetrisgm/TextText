import { blogBaseUrl, notFound, postUrl } from "@/lib/agent-surface";
import { postBodyPreview, type Post } from "@/lib/content";
import { resolveCoverUrl } from "@/lib/cover";
import { getBlog, getPosts } from "@/lib/store";
import { postSubtitle } from "@/lib/markdown-subtitle";

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
