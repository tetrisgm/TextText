import { tidyPublisherName } from "@/lib/reading/publisher-name";

/**
 * Who published an item, the mark that stands for them, and whether an
 * excerpt is worth showing.
 *
 * A news surface is unreadable without publisher identity: it is the first
 * thing on the row and the thing a person scans for. Two problems to solve.
 *
 * An aggregator feed names itself, not the publisher. A Hacker News entry
 * carries "Hacker News: Newest" as its publisher and links out to the site
 * that actually wrote the piece, so the honest name is the host the link
 * points at, with the feed kept as the route it arrived by.
 *
 * And most feeds supply no icon. Rather than leave a hole in the row, a
 * monogram tile in a colour derived from the name stands in: deterministic,
 * so the same publisher is the same colour every time, and free, because it
 * costs no request.
 */

export { tidyPublisherName } from "@/lib/reading/publisher-name";

export type PublisherIdentity = {
  /** The name to show before the headline. */
  name: string;
  /** The feed it arrived through, when that is not the publisher itself. */
  via: string | null;
  /** The host the item links to, when it has one. */
  domain: string | null;
  /** One or two letters for the monogram tile. */
  initials: string;
  /** A stable CSS colour for the tile. */
  color: string;
};

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Two letters at most, skipping the noise words a feed title collects. */
export function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .split(/[\s.-]+/)
    .filter((word) => word.length > 0 && !/^(the|a|an|of|and|com|net|org|io|news)$/i.test(word));
  const source = words.length > 0 ? words : [name.replace(/[^\p{L}\p{N}]/gu, "")];
  // Two letters fill the tile; one leaves it looking unfinished. A single
  // word lends its first two, which is what a domain usually is.
  const initials = source.length > 1 ? `${source[0][0]}${source[1][0]}` : (source[0] ?? "?").slice(0, 2);
  return initials.toUpperCase().slice(0, 2) || "?";
}

/**
 * The monogram tiles.
 *
 * A fixed set rather than a hue from a hash: a hash walks the whole wheel and
 * a good third of it cannot carry white text at a legible contrast. Each of
 * these is measured against white in the contrast test, so every tile in the
 * list is readable whatever name lands on it.
 */
export const MARK_COLORS = [
  "#2c18ac",
  "#b3123f",
  "#8a3a00",
  "#0f5c4a",
  "#1f4fa8",
  "#6a2b8f",
  "#8c1d1d",
  "#2f4858",
] as const;

/** The same publisher gets the same tile every time. */
export function markColor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return MARK_COLORS[hash % MARK_COLORS.length];
}

/** Compacted for comparison: "The Verge" and "theverge.com" are the same name. */
function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Whether a feed's own name plausibly belongs to the site it links to. A
 * publisher's feed names itself after its site; an aggregator's does not, and
 * that difference is the only signal available without another request.
 */
export function nameMatchesHost(name: string, host: string): boolean {
  const flat = compact(name);
  if (!flat) return false;
  const labels = host.split(".").filter((label) => label.length > 2 && !/^(com|net|org|co|io|app|news|www)$/.test(label));
  return labels.some((label) => flat.includes(label) || label.includes(flat));
}

export function publisherFor(item: {
  publisherName?: string | null;
  publisherTitle?: string | null;
  sourceFolderName?: string | null;
  externalUrl?: string | null;
  permalink?: string | null;
}): PublisherIdentity {
  const feedName = tidyPublisherName(
    (item.publisherName ?? "").trim() ||
      (item.publisherTitle ?? "").trim() ||
      (item.sourceFolderName ?? "").trim() ||
      "Unknown",
  );
  const linkHost = hostOf(item.externalUrl) ?? hostOf(item.permalink);
  // A feed whose name does not belong to the site it links to is an
  // aggregator, and the site is the publisher a person would recognise. The
  // feed is kept as the route the item arrived by, never dropped.
  const aggregated = Boolean(linkHost && !nameMatchesHost(feedName, linkHost));
  const name = aggregated ? linkHost! : feedName;
  // "Hacker News: Front Page" is the route, and the route's name is enough.
  const via = aggregated ? feedName.split(":")[0].trim() || feedName : null;
  return {
    name,
    via,
    domain: linkHost,
    initials: initialsOf(name),
    color: markColor(name),
  };
}

/**
 * Whether an excerpt is prose worth showing under a headline.
 *
 * Aggregator feeds put a block of links in the body ("Article URL: ...
 * Comments URL: ... Points: 2"), which reads as noise under a headline and
 * is the loudest thing on the row when set at excerpt size. Strip the URLs
 * and the labels; if almost nothing is left, there was nothing to say. What
 * comes back is the prose without the links, which is what belongs under a
 * headline.
 */
export function usableExcerpt(excerpt: string | null | undefined): string | null {
  if (!excerpt) return null;
  const prose = excerpt
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b(article|comments?|source|link)s?\s+url\s*:?/gi, " ")
    .replace(/\b(points?|comments?)\s*:\s*\d+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return prose.length >= 40 ? prose : null;
}
