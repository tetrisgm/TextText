import {
  blogBaseUrl,
  locatedPostUrl,
  notFound,
  publishedPublicLocations,
} from "@/lib/agent-surface";
import type { Post } from "@/lib/content";
import { getBlog, getPublicPostLocations } from "@/lib/store";
import type { PublicPostLocation } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string }>;
}

const FALLBACK_DATE = new Date("1970-01-01T00:00:00.000Z");

export async function GET(_request: Request, { params }: Props) {
  const { handle } = await params;
  const blog = await getBlog(handle);
  if (!blog) return notFound();

  const locations = newestFirst(
    publishedPublicLocations(await getPublicPostLocations(handle)),
  );
  const baseUrl = blogBaseUrl(blog);

  return new Response(renderSitemap(locations, baseUrl), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}

function renderSitemap(locations: PublicPostLocation[], baseUrl: string): string {
  const posts = locations.map((location) => location.post);
  const homeLastModified = feedDate(posts).toISOString();
  const postEntries = posts
    .map((post, index) => {
      const url = locatedPostUrl(baseUrl, locations[index]!);
      const lastModified = postDate(post).toISOString();

      return [
        "  <url>",
        `    <loc>${escapeXml(url)}</loc>`,
        `    <lastmod>${escapeXml(lastModified)}</lastmod>`,
        "    <changefreq>monthly</changefreq>",
        "    <priority>0.7</priority>",
        "  </url>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url>",
    `    <loc>${escapeXml(baseUrl)}</loc>`,
    `    <lastmod>${escapeXml(homeLastModified)}</lastmod>`,
    "    <changefreq>weekly</changefreq>",
    "    <priority>1.0</priority>",
    "  </url>",
    postEntries,
    "</urlset>",
    "",
  ].join("\n");
}

function newestFirst(locations: PublicPostLocation[]): PublicPostLocation[] {
  return [...locations].sort((a, b) => {
    const byDate = postDate(b.post).getTime() - postDate(a.post).getTime();
    return byDate || a.post.slug.localeCompare(b.post.slug);
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

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
