import { describe, expect, it } from "vitest";
import type { ReadingListItem } from "../list.server";
import { clusterReadingItems, titleTokens } from "../summaries.server";

function item(id: string, title: string, at: string, extra: Partial<ReadingListItem> = {}): ReadingListItem {
  return {
    id,
    origin: "feed",
    title,
    publisherTitle: title,
    publisherName: extra.publisherName ?? "Source A",
    folderId: "f",
    folderPath: "bookmarks/a",
    sourceFolderName: "A",
    permalink: extra.permalink ?? `https://example.test/${id}`,
    externalUrl: null,
    publishedAt: at,
    receivedAt: at,
    availability: "full",
    excerpt: null,
    authors: [],
    read: extra.read ?? false,
    starred: false,
    kept: false,
    keptReasons: [],
    expiresAt: null,
    slug: id,
    ...extra,
  };
}

describe("Summaries grouping", () => {
  it("drops stop words and short tokens from titles", () => {
    expect([...titleTokens("The GPU driver for the M4 Mac is here")]).toEqual(["gpu", "driver", "mac", "here"]);
  });

  it("groups the same news from two sources by title overlap within the window", () => {
    const summaries = clusterReadingItems([
      item("1", "Rheinmetall open-sources its Battlesuite protocol", "2026-09-15T10:00:00Z", { publisherName: "Hacker News" }),
      item("2", "Rheinmetall open sources Battlesuite weapon protocol", "2026-09-15T14:00:00Z", { publisherName: "The Verge" }),
      item("3", "How much oil-market buffer is left?", "2026-09-15T11:00:00Z"),
    ]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].members.map((member) => member.id).sort()).toEqual(["1", "2"]);
    expect(summaries[0].sources.sort()).toEqual(["Hacker News", "The Verge"]);
    expect(summaries[0].headline).toBe("Rheinmetall open-sources its Battlesuite protocol");
  });

  it("groups by canonical link even when titles differ, ignoring tracking parameters", () => {
    const summaries = clusterReadingItems([
      item("1", "Serre turns 100", "2026-09-15T10:00:00Z", { permalink: "https://news.test/serre?utm_source=a" }),
      item("2", "A century of Jean-Pierre Serre", "2026-09-15T12:00:00Z", { permalink: "https://news.test/serre/?utm_source=b", publisherName: "Source B" }),
    ]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].unread).toBe(2);
  });

  it("never groups on weak overlap, short titles, or across the time window", () => {
    expect(
      clusterReadingItems([
        item("1", "Market update", "2026-09-15T10:00:00Z"),
        item("2", "Market update", "2026-09-15T11:00:00Z", { publisherName: "Source B" }),
      ]),
    ).toEqual([]);
    expect(
      clusterReadingItems([
        item("1", "Oil market buffer shrinks again", "2026-09-01T10:00:00Z"),
        item("2", "Oil market buffer shrinks again", "2026-09-15T10:00:00Z", { publisherName: "Source B" }),
      ]),
    ).toEqual([]);
    expect(
      clusterReadingItems([
        item("1", "Building a Linux GPU driver in one month", "2026-09-15T10:00:00Z"),
        item("2", "Building a house in one month", "2026-09-15T11:00:00Z", { publisherName: "Source B" }),
      ]),
    ).toEqual([]);
  });
});
