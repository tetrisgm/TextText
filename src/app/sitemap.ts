import type { MetadataRoute } from "next";
import { rootDomainUrl } from "@/lib/site-url";

const fallbackLastModified = new Date("2026-07-08T00:00:00.000Z");

function absolute(path: string): string {
  return new URL(path, rootDomainUrl()).toString();
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
  ];

  // Workspaces advertise their own sitemap from their sessionless workspace
  // origin, so the platform sitemap lists only platform routes.
  return platformRoutes;
}
