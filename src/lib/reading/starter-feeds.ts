/**
 * The sources a workspace starts with.
 *
 * A news surface with nothing in it is not a news surface. The app this Home
 * is modelled on opened full: you were given publishers, and taking one away
 * was a click. So is this. These are followed once, the first time a workspace
 * would otherwise show an empty feed, and every one of them can be detached
 * from Manage sources afterwards.
 *
 * Chosen for breadth rather than taste, and for feeds that carry pictures,
 * because a feed without them renders as a wall of type. Every endpoint here
 * was fetched and parsed before it was written down.
 */

import type { Channel } from "./channels";

export type StarterFeed = {
  /** The channel this source feeds. A name from `channels.ts`, so a fresh
   * workspace opens with a strip of subjects rather than sixteen URLs. */
  topic: Channel;
  name: string;
  url: string;
  site: string;
};

export const STARTER_FEEDS: readonly StarterFeed[] = [
  { topic: "Technology", name: "The Verge", url: "https://www.theverge.com/rss/index.xml", site: "https://www.theverge.com" },
  { topic: "Technology", name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", site: "https://arstechnica.com" },
  { topic: "Technology", name: "Wired", url: "https://www.wired.com/feed/rss", site: "https://www.wired.com" },
  { topic: "Technology", name: "TechCrunch", url: "https://techcrunch.com/feed/", site: "https://techcrunch.com" },
  { topic: "Technology", name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", site: "https://www.technologyreview.com" },
  { topic: "Technology", name: "Hacker News: Front Page", url: "https://hnrss.org/frontpage", site: "https://news.ycombinator.com" },
  { topic: "Science", name: "Quanta Magazine", url: "https://www.quantamagazine.org/feed/", site: "https://www.quantamagazine.org" },
  { topic: "Science", name: "Nature News", url: "https://www.nature.com/nature.rss", site: "https://www.nature.com" },
  { topic: "Science", name: "NASA", url: "https://www.nasa.gov/news-release/feed/", site: "https://www.nasa.gov" },
  { topic: "Design", name: "Dezeen", url: "https://www.dezeen.com/feed/", site: "https://www.dezeen.com" },
  { topic: "Design", name: "ArchDaily", url: "https://www.archdaily.com/feed", site: "https://www.archdaily.com" },
  { topic: "World", name: "BBC News: World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", site: "https://www.bbc.com/news/world" },
  { topic: "World", name: "The Guardian: World", url: "https://www.theguardian.com/world/rss", site: "https://www.theguardian.com/world" },
  { topic: "World", name: "NPR: News", url: "https://feeds.npr.org/1001/rss.xml", site: "https://www.npr.org" },
  { topic: "Games", name: "Polygon", url: "https://www.polygon.com/rss/index.xml", site: "https://www.polygon.com" },
  { topic: "Games", name: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/feed", site: "https://www.rockpapershotgun.com" },
];

/** Recorded on the first pass, so a part-finished set is resumed rather than
 * mistaken for a workspace that chose its own sources. */
export const STARTER_STARTED = "reading.starter_started";
/** Recorded once the whole set is followed. A workspace carrying this is never
 * seeded again, however many sources it has left afterwards. */
export const STARTER_ACTION = "reading.starter_applied";

export function starterTopics(): string[] {
  return [...new Set(STARTER_FEEDS.map((feed) => feed.topic))];
}
