import type { MetadataRoute } from "next";
import { DEMO_BLOG, DEMO_POSTS } from "@/lib/demo";
import { blogHomePath, blogPostPath } from "@/lib/public-paths";
import { rootDomainUrl } from "@/lib/site-url";

const fallbackLastModified = new Date("2026-07-08T00:00:00.000Z");

function absolute(path: string): string {
  return new URL(path, rootDomainUrl()).toString();
}

function postLastModified(date: string | undefined): Date {
  if (!date) return fallbackLastModified;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00.000Z`)
    : new Date(date);
  return Number.isNaN(parsed.getTime()) ? fallbackLastModified : parsed;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const platformRoutes: MetadataRoute.Sitemap = [
    {
      url: absolute("/"),
      lastModified: fallbackLastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: absolute("/download"),
      lastModified: fallbackLastModified,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: absolute("/docs/ai"),
      lastModified: fallbackLastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: absolute("/llms.txt"),
      lastModified: fallbackLastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: absolute("/openapi.json"),
      lastModified: fallbackLastModified,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: absolute(blogHomePath(DEMO_BLOG)),
      lastModified: postLastModified(DEMO_POSTS[0]?.date),
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];

  const demoPostRoutes = DEMO_POSTS.filter((post) => post.status === "published")
    .map((post) => ({
      url: absolute(blogPostPath(DEMO_BLOG, post)),
      lastModified: postLastModified(post.date),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    }));

  return [...platformRoutes, ...demoPostRoutes];
}
