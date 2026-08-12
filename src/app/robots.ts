import type { MetadataRoute } from "next";
import { rootDomainUrl } from "@/lib/site-url";

function absolute(path: string): string {
  return new URL(path, rootDomainUrl()).toString();
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/@", "/t/"],
      disallow: ["/editor", "/connect", "/api"],
    },
    sitemap: absolute("/sitemap.xml"),
    host: rootDomainUrl().origin,
  };
}
