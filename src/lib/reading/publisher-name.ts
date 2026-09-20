/**
 * The name a person would say, out of the name a feed gives itself.
 *
 * Feed titles are catalogue entries, not mastheads: "World news | The
 * Guardian", "Ars Technica - All content", "Rock Paper Shotgun Latest
 * Articles Feed". Set at publisher size above a headline they are the
 * loudest wrong thing on the row. The conventions are few and stable enough
 * to undo: the brand sits after a pipe and before a colon, and the rest is
 * boilerplate that says "feed" in one of a handful of ways.
 */
export function tidyPublisherName(raw: string): string {
  let name = raw.trim();
  // "<section> | <Brand>" keeps the brand; "<Brand>: <section>" keeps the brand.
  const piped = name.split("|").map((part) => part.trim()).filter(Boolean);
  if (piped.length > 1) name = piped[piped.length - 1];
  const colon = name.split(":").map((part) => part.trim()).filter(Boolean);
  // "<Brand>: <section>" keeps the brand, unless the head is itself
  // boilerplate ("RSS: Daring Fireball"), where the brand is on the right.
  if (colon.length > 1) name = /^(rss|feed|atom|blog)$/i.test(colon[0]) ? colon[colon.length - 1] : colon[0];
  name = name
    .replace(/\s*[-\u2013\u2014]\s*(all content|all posts|full text|latest|feed|rss)\b.*$/i, "")
    .replace(/\s+(latest\s+)?(articles?|stories|posts|headlines|topics|news)?\s*(rss\s*)?feed$/i, "")
    .replace(/\s+topics$/i, "")
    .replace(/^rss\s*[:\u2013-]?\s*/i, "")
    .trim();
  // A bare domain reads better without its suffix: "Polygon.com" is Polygon.
  const bareDomain = /^([\p{L}\p{N}-]+)\.(com|net|org|io|co|news|co\.uk)$/iu.exec(name);
  if (bareDomain) name = bareDomain[1];
  return name || raw.trim();
}

/** Publisher identity follows the article, including links from aggregators. */
export function publisherPreferenceTarget(item: { permalink?: string | null; externalUrl?: string | null; folderPath: string }): string {
  for (const link of [item.permalink, item.externalUrl]) {
    if (!link) continue;
    try {
      const url = new URL(link);
      if (url.protocol === "https:" || url.protocol === "http:") return `publisher:${url.hostname.toLowerCase().replace(/^www\./, "")}`;
    } catch { /* A missing publisher falls back to its feed. */ }
  }
  return item.folderPath;
}
