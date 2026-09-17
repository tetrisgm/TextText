import { describe, expect, it } from "vitest";
import { CHANNELS, channelForSource, channelTopicId, isChannel, registrableHost, sortChannels } from "../channels";
import { channelTopicsFrom } from "../home.server";
import { STARTER_FEEDS } from "../starter-feeds";
import { roundRobinByChannel } from "../starter.server";

/**
 * Channels are the strip across the top of the news, so what belongs in one
 * is a product claim, not a detail: a source placed in the wrong subject puts
 * a games review under World, and a source placed in none has no tab at all.
 */

describe("placing a source in a channel", () => {
  it("knows the publishers it was told about, whatever the feed's host looks like", () => {
    expect(channelForSource({ siteUrl: "https://www.theverge.com" })).toBe("Technology");
    expect(channelForSource({ endpointUrl: "https://feeds.arstechnica.com/arstechnica/index" })).toBe("Technology");
    expect(channelForSource({ endpointUrl: "https://feeds.bbci.co.uk/news/world/rss.xml" })).toBe("World");
    expect(channelForSource({ siteUrl: "https://news.ycombinator.com" })).toBe("Technology");
    expect(channelForSource({ siteUrl: "https://www.polygon.com" })).toBe("Games");
  });

  it("falls back to the words in the name, on whole words only", () => {
    expect(channelForSource({ name: "Indie Game Roundup", siteUrl: "https://example.test" })).toBe("Games");
    expect(channelForSource({ name: "Architecture Weekly", siteUrl: "https://example.test" })).toBe("Design");
    // "ai" must not match inside "airing", "said" or "rails".
    expect(channelForSource({ name: "Airing Cupboard Diaries", siteUrl: "https://example.test" })).toBeNull();
    // "search" must not answer for "research".
    expect(channelForSource({ name: "Research Notes", siteUrl: "https://example.test" })).toBe("Science");
  });

  it("says nothing rather than guessing", () => {
    expect(channelForSource({ name: "Ramine", siteUrl: "https://ramine.test" })).toBeNull();
    expect(channelForSource({})).toBeNull();
  });

  it("reads the registrable host through two-part suffixes", () => {
    expect(registrableHost("https://feeds.bbci.co.uk/news/world/rss.xml")).toBe("bbci.co.uk");
    expect(registrableHost("https://www.theguardian.com/world/rss")).toBe("theguardian.com");
    expect(registrableHost("theverge.com")).toBe("theverge.com");
    expect(registrableHost("not a url at all")).toBeNull();
    expect(registrableHost(null)).toBeNull();
  });
});

describe("the strip", () => {
  it("orders channels by the catalogue, and anything else after it", () => {
    expect(sortChannels(["Games", "Technology", "World"])).toEqual(["Technology", "World", "Games"]);
    expect(sortChannels(["Zebras", "Technology", "Aardvarks"])).toEqual(["Technology", "Aardvarks", "Zebras"]);
    expect(sortChannels(["World", "World"])).toEqual(["World"]);
  });

  const source = (folderPath: string, channel: string | null, publisherTitle: string | null = null) =>
    ({ folderPath, channel, publisherTitle, folderName: folderPath.split("/").pop() ?? "", state: "active" }) as never;

  it("is subjects, never publishers, and names the sources behind each", () => {
    const topics = channelTopicsFrom([
      source("bookmarks/the-verge", "Technology", "The Verge"),
      source("bookmarks/wired", "Technology", "WIRED"),
      source("bookmarks/polygon", "Games", "Polygon.com"),
      source("bookmarks/private-notes", null, "Something"),
    ]);
    expect(topics.map((topic) => topic.label)).toEqual(["Technology", "Games"]);
    expect(topics.every((topic) => topic.kind === "channel")).toBe(true);
    expect(topics[0].id).toBe(channelTopicId("Technology"));
    expect(topics[0].detail).toBe("The Verge, WIRED");
    // The feed title is tidied for the tooltip the same way it is for a row.
    expect(topics[1].detail).toBe("Polygon");
  });

  it("leaves detached sources out", () => {
    const detached = { ...(source("bookmarks/old", "World", "Old") as object), state: "detached" } as never;
    expect(channelTopicsFrom([detached])).toEqual([]);
  });
});

describe("the starter set", () => {
  it("only names channels the catalogue knows", () => {
    for (const feed of STARTER_FEEDS) expect(isChannel(feed.topic), feed.name).toBe(true);
  });

  it("follows one source per channel before the second of any", () => {
    const order = roundRobinByChannel(STARTER_FEEDS);
    expect(order).toHaveLength(STARTER_FEEDS.length);
    const channels = [...new Set(STARTER_FEEDS.map((feed) => feed.topic))];
    // The first pass has to touch every channel, or a workspace opened while
    // it is still running shows tabs with nothing behind them.
    expect(new Set(order.slice(0, channels.length).map((feed) => feed.topic)).size).toBe(channels.length);
    expect(new Set(order.map((feed) => feed.name)).size).toBe(STARTER_FEEDS.length);
  });

  it("names every channel in the catalogue", () => {
    expect(new Set(CHANNELS).size).toBe(CHANNELS.length);
  });
});
