import type { Metadata } from "next";

const FALLBACK_ROOT_DOMAIN = "localhost:3000";

type AlternateTypes = NonNullable<
  NonNullable<Metadata["alternates"]>["types"]
>;

export function blogFeedHref(handle: string): string {
  return `${blogPath(handle)}/feed.xml`;
}

export function blogFeedAlternateTypes(
  handle: string,
  blogName: string,
): AlternateTypes {
  const basePath = blogPath(handle);
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

function blogPath(handle: string): string {
  return `/t/${encodeURIComponent(handle)}`;
}

function absoluteUrl(path: string): string {
  return new URL(path, rootDomainUrl()).toString();
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
