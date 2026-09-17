import { describe, expect, it } from "vitest";
import type { ReadingListItem } from "../list.server";
import { parseTopic, representativeOf, unitsFrom } from "../home.server";
import { clusterReadingItems } from "../summaries.server";

function item(id: string, title: string, at: string, extra: Partial<ReadingListItem> = {}): ReadingListItem {
  return {
    id, origin: "feed", title, publisherTitle: "P", publisherName: extra.publisherName ?? "Wire", folderId: "f", folderPath: "bookmarks/wire", sourceFolderName: "Wire",
    permalink: `https://x.example/${id}`, externalUrl: null, publishedAt: at, receivedAt: at, availability: "full", imageUrl: null, wordCount: 0, excerpt: null, authors: [],
    read: false, starred: false, kept: false, keptReasons: [], expiresAt: null, slug: id, cursor: id, ...extra,
  };
}

describe("home units", () => {
  const a1 = item("a1", "Apple unveils new MacBook Pro with M5 chip", "2026-09-17T10:00:00Z", { imageUrl: "https://img.example/a.jpg", read: true });
  const b1 = item("b1", "New MacBook Pro with M5 chip unveiled by Apple", "2026-09-17T11:00:00Z", { publisherName: "Daily" });
  const solo = item("s1", "A quiet afternoon in the garden", "2026-09-17T12:00:00Z");
  const old = item("o1", "Something from yesterday", "2026-09-16T09:00:00Z");

  it("groups what clusters, keeps the rest as articles, newest first", () => {
    const items = [solo, b1, a1, old];
    const units = unitsFrom(items, clusterReadingItems(items));
    expect(units.map((unit) => `${unit.kind}:${unit.id}`)).toEqual(["article:s1", "summary:a1+b1", "article:o1"]);
    const summary = units[1];
    if (summary.kind !== "summary") throw new Error("expected a summary");
    expect(summary.sources).toEqual(["Daily", "Wire"]);
    expect(summary.imageUrl).toBe("https://img.example/a.jpg");
    expect(summary.unread).toBe(1);
  });

  it("opens the newest unread member, else the newest", () => {
    expect(representativeOf({ members: [b1, a1] }).id).toBe("b1");
    expect(representativeOf({ members: [{ ...b1, read: true }, a1] }).id).toBe("b1");
    expect(representativeOf({ members: [{ ...b1, read: true }, { ...a1, read: false }] }).id).toBe("a1");
  });

  it("reads topic ids and refuses anything else", () => {
    expect(parseTopic("search:abc")).toEqual({ kind: "search", id: "abc" });
    expect(parseTopic("source:bookmarks/wire")).toEqual({ kind: "source", folderPath: "bookmarks/wire" });
    expect(parseTopic("")).toBeNull();
    expect(parseTopic("folder:x")).toBeNull();
  });
});
