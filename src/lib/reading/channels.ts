/**
 * Channels: the subjects the news is divided into.
 *
 * The app this Home copies put one strip across the top of the news, and the
 * strip was subjects, not publishers: For You, U.S. Politics, Stocks, Tech
 * Cos. A publisher belonged to a subject; it never had a tab of its own,
 * because nobody opens a news app wanting "Polygon.com", they want games.
 *
 * A channel here is a named set of sources. That is coarser than classifying
 * every article, and it is honest: the person can see exactly which sources
 * feed a channel and move one with a click, which is more than the original
 * ever offered. The subject of an individual article is left to Summaries and
 * the derived topics, which is where a claim about one article belongs.
 *
 * No server imports: the client renders the strip from the same list.
 */

/**
 * The catalogue, in the order the strip shows them. A workspace only ever
 * sees the channels its own sources are in, so a short list is not a
 * limitation, it is the point: six legible subjects beat twenty.
 */
export const CHANNELS = [
  "Technology",
  "Business",
  "Science",
  "World",
  "Politics",
  "Design",
  "Culture",
  "Games",
  "Sports",
  "Health",
] as const;

export type Channel = (typeof CHANNELS)[number];

const ORDER = new Map(CHANNELS.map((name, index) => [name, index] as const));

/** Strip order: the catalogue's, then anything unrecognised, alphabetically. */
export function sortChannels(names: readonly string[]): string[] {
  return [...new Set(names)].sort((left, right) => {
    const a = ORDER.get(left as Channel) ?? Number.MAX_SAFE_INTEGER;
    const b = ORDER.get(right as Channel) ?? Number.MAX_SAFE_INTEGER;
    return a - b || left.localeCompare(right);
  });
}

export function isChannel(value: string | null | undefined): value is Channel {
  return typeof value === "string" && ORDER.has(value as Channel);
}

/**
 * Publishers we can place without guessing. Matched on the registrable part
 * of the host, so www., feeds. and rss. prefixes all land on the same entry.
 */
const BY_HOST: Record<string, Channel> = {
  "theverge.com": "Technology",
  "arstechnica.com": "Technology",
  "wired.com": "Technology",
  "techcrunch.com": "Technology",
  "technologyreview.com": "Technology",
  "ycombinator.com": "Technology",
  "hnrss.org": "Technology",
  "engadget.com": "Technology",
  "9to5mac.com": "Technology",
  "macrumors.com": "Technology",
  "theregister.com": "Technology",
  "zdnet.com": "Technology",
  "anandtech.com": "Technology",
  "daringfireball.net": "Technology",
  "simonwillison.net": "Technology",
  "stratechery.com": "Business",
  "ft.com": "Business",
  "economist.com": "Business",
  "bloomberg.com": "Business",
  "wsj.com": "Business",
  "cnbc.com": "Business",
  "hbr.org": "Business",
  "marketwatch.com": "Business",
  "quantamagazine.org": "Science",
  "nature.com": "Science",
  "science.org": "Science",
  "nasa.gov": "Science",
  "scientificamerican.com": "Science",
  "newscientist.com": "Science",
  "phys.org": "Science",
  "eos.org": "Science",
  "bbc.co.uk": "World",
  "bbci.co.uk": "World",
  "bbc.com": "World",
  "theguardian.com": "World",
  "npr.org": "World",
  "reuters.com": "World",
  "apnews.com": "World",
  "aljazeera.com": "World",
  "nytimes.com": "World",
  "politico.com": "Politics",
  "thehill.com": "Politics",
  "fivethirtyeight.com": "Politics",
  "dezeen.com": "Design",
  "archdaily.com": "Design",
  "designmilk.com": "Design",
  "core77.com": "Design",
  "itsnicethat.com": "Design",
  "polygon.com": "Games",
  "rockpapershotgun.com": "Games",
  "eurogamer.net": "Games",
  "ign.com": "Games",
  "gamespot.com": "Games",
  "kotaku.com": "Games",
  "pcgamer.com": "Games",
  "pitchfork.com": "Culture",
  "vulture.com": "Culture",
  "newyorker.com": "Culture",
  "theatlantic.com": "Culture",
  "variety.com": "Culture",
  "hollywoodreporter.com": "Culture",
  "espn.com": "Sports",
  "theathletic.com": "Sports",
  "skysports.com": "Sports",
  "autosport.com": "Sports",
  "statnews.com": "Health",
  "healthline.com": "Health",
  "medscape.com": "Health",
};

/**
 * Words that place a source the host map does not know.
 *
 * A term ending in "*" matches from the start of a word and may continue, so
 * "architect*" takes Architecture; every other term must be the whole word,
 * so "ai" does not read "airing" and "search" does not answer for "research".
 * Ordered: the first channel whose words appear wins, so a "science and
 * technology" feed lands in Science rather than being argued over.
 */
const BY_WORD: ReadonlyArray<readonly [Channel, readonly string[]]> = [
  ["Games", ["game*", "esports", "playstation", "xbox", "nintendo", "roguelike*"]],
  ["Design", ["design*", "architect*", "typograph*", "interior", "furniture", "industrial design"]],
  ["Science", ["science", "scientific", "physic*", "biolog*", "astronom*", "space", "climate", "research", "chemistry"]],
  ["Health", ["health*", "medicin*", "medical", "fitness", "nutrition"]],
  ["Sports", ["sport*", "football", "soccer", "basketball", "cricket", "cycling", "formula 1", "f1", "olympic*"]],
  ["Politics", ["politic*", "election*", "congress", "parliament", "senate"]],
  ["Business", ["business", "market*", "econom*", "financ*", "startup*", "venture", "stocks", "investing"]],
  ["Culture", ["film*", "movie*", "music", "book*", "art", "arts", "culture", "television", "theatre", "theater"]],
  ["World", ["world", "news", "international", "global", "headline*", "politics"]],
  ["Technology", ["tech", "technolog*", "software", "developer*", "programming", "computer*", "ai", "gadget*", "hardware"]],
];

function matches(words: string, term: string): boolean {
  const stem = term.endsWith("*");
  const body = (stem ? term.slice(0, -1) : term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${body}${stem ? "" : "([^a-z0-9]|$)"}`).test(words);
}

/** The registrable host, lowercased: "www.theverge.com" and "feeds.theverge.com" both give "theverge.com". */
export function registrableHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase();
    const parts = host.split(".").filter(Boolean);
    if (parts.length <= 2) return parts.join(".");
    // Two-part public suffixes we actually meet, so bbc.co.uk does not
    // collapse to co.uk.
    const tail = parts.slice(-2).join(".");
    if (["co.uk", "com.au", "co.nz", "co.jp", "com.br"].includes(tail)) return parts.slice(-3).join(".");
    return tail;
  } catch {
    return null;
  }
}

/**
 * Where a source belongs, from what we know about it at the moment it is
 * followed. Null means we do not know: the source still appears in For You
 * and in Latest, it simply has no tab, and one click in Manage sources gives
 * it one. A wrong guess would be worse than no guess.
 */
export function channelForSource(input: {
  name?: string | null;
  publisherTitle?: string | null;
  siteUrl?: string | null;
  endpointUrl?: string | null;
}): Channel | null {
  for (const url of [input.siteUrl, input.endpointUrl]) {
    const host = registrableHost(url);
    if (host && BY_HOST[host]) return BY_HOST[host];
  }
  const words = [input.name, input.publisherTitle, input.siteUrl, input.endpointUrl]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!words) return null;
  for (const [channel, terms] of BY_WORD) {
    if (terms.some((term) => matches(words, term))) return channel;
  }
  return null;
}

export const CHANNEL_PREFIX = "channel:";

export function channelTopicId(channel: string): string {
  return `${CHANNEL_PREFIX}${channel}`;
}
