import type { Metadata } from "next";
import type { Blog } from "@/lib/content";
import { rootDomainUrl } from "@/lib/site-url";
import { workspacePublicBaseUrl } from "@/lib/public-paths";

type AlternateTypes = NonNullable<
  NonNullable<Metadata["alternates"]>["types"]
>;
type BlogPathTarget = string | Pick<Blog, "handle" | "username">;

export function blogFeedHref(target: BlogPathTarget): string {
  return `${blogPath(target)}/feed.xml`;
}

export function blogAtomHref(target: BlogPathTarget): string {
  return `${blogPath(target)}/atom.xml`;
}

export function blogJsonFeedHref(target: BlogPathTarget): string {
  return `${blogPath(target)}/feed.json`;
}

export function blogFeedAlternateTypes(
  target: BlogPathTarget,
  blogName: string,
): AlternateTypes {
  const basePath = blogPath(target);
  return {
    "application/rss+xml": [
      {
        title: `${blogName} RSS feed`,
        url: absoluteUrl(`${basePath}/feed.xml`),
      },
    ],
    "application/atom+xml": [
      {
        title: `${blogName} Atom feed`,
        url: absoluteUrl(`${basePath}/atom.xml`),
      },
    ],
    "application/feed+json": [
      {
        title: `${blogName} JSON feed`,
        url: absoluteUrl(`${basePath}/feed.json`),
      },
    ],
  };
}

function blogPath(target: BlogPathTarget): string {
  if (typeof target === "string") return `/t/${encodeURIComponent(target)}`;
  return workspacePublicBaseUrl(target.handle);
}

function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return new URL(path, rootDomainUrl()).toString();
}
