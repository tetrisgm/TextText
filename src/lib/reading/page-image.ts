/**
 * The picture a page says it has.
 *
 * Most feeds send no image, which leaves a news surface with nothing to show
 * but type. Nearly every article page, though, declares one for social cards.
 * Reading that declaration is one request per item and no parsing of the page
 * body, so it stays cheap enough to run from the app's own tick.
 *
 * Pure text handling only: the fetching, the bounds and the recording live in
 * images.server.ts, so this can be tested without a network.
 */

const META = /<meta\b[^>]*>/gi;
const LINK = /<link\b[^>]*>/gi;

function attribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const match = pattern.exec(tag);
  if (!match) return null;
  const raw = match[2] ?? match[3] ?? match[4] ?? "";
  return decodeEntities(raw.trim());
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/** Absolute https only: the home page hotlinks these, so http would break the page. */
export function absoluteHttps(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:") return null;
    const href = url.toString();
    return href.length <= 2000 ? href : null;
  } catch {
    return null;
  }
}

export type PageMeta = {
  /** The page's own lead image, when it declares one. */
  image: string | null;
  /** The publication's name, when the page declares one. */
  siteName: string | null;
};

/**
 * Read the social card declarations out of a page's head. Ordered by how much
 * the publisher meant it: og:image is the deliberate one, twitter:image the
 * fallback, and a bare itemprop the last resort.
 */
export function pageMetaFromHtml(html: string, url: string): PageMeta {
  const head = html.slice(0, 200_000);
  const candidates = new Map<string, string>();
  let siteName: string | null = null;
  for (const match of head.matchAll(META)) {
    const tag = match[0];
    const key = (attribute(tag, "property") ?? attribute(tag, "name") ?? attribute(tag, "itemprop") ?? "").toLowerCase();
    if (!key) continue;
    const content = attribute(tag, "content");
    if (!content) continue;
    if (key === "og:site_name" && !siteName) siteName = content.slice(0, 120);
    if (["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src", "image"].includes(key)) {
      if (!candidates.has(key)) candidates.set(key, content);
    }
  }
  for (const key of ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src", "image"]) {
    const resolved = absoluteHttps(candidates.get(key) ?? null, url);
    if (resolved) return { image: resolved, siteName };
  }
  // A page with no card image sometimes still names a large icon, which is
  // better than an empty tile.
  for (const match of head.matchAll(LINK)) {
    const tag = match[0];
    const rel = (attribute(tag, "rel") ?? "").toLowerCase();
    if (!rel.includes("apple-touch-icon")) continue;
    const resolved = absoluteHttps(attribute(tag, "href"), url);
    if (resolved) return { image: resolved, siteName };
  }
  return { image: null, siteName };
}
