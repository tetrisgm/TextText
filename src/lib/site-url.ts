// Root-domain URL resolution, shared by feeds, sitemaps, metadata, and the
// agent surface. One place decides the scheme (http for local hosts, https
// everywhere else) and the fallback, so every absolute URL agrees.

const FALLBACK_ROOT_DOMAIN = "TextText.app";

/** The platform root as a URL, derived from env with a local fallback. */
export function rootDomainUrl(): URL {
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
    return new URL(`https://${FALLBACK_ROOT_DOMAIN}`);
  }
}

/** True for localhost-style hosts that should be served over plain http. */
export function isLocalDomain(value: string): boolean {
  const host = value.split("/")[0]?.split(":")[0]?.toLowerCase() || "";
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1";
}
