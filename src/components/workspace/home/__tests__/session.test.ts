import { describe, expect, it, vi } from "vitest";
import { HomeSession } from "../session";
import type { HomeNews, HomeUnit, ReadingListItem } from "@/lib/reading/client";
import { savedLibraryScope, type SavedLibraryView } from "@/lib/reading/saved-library-client";

const item = (id: string): ReadingListItem => ({ id, origin: "feed", title: id, publisherTitle: "Wire", publisherName: "Wire", folderId: "f", folderPath: "bookmarks/wire", sourceFolderName: "Wire", permalink: null, externalUrl: null, publishedAt: null, receivedAt: "2026-09-19", availability: "full", imageUrl: null, wordCount: 100, excerpt: null, authors: [], read: false, starred: false, kept: false, keptReasons: [], expiresAt: null, slug: id, cursor: id });
const article = (id: string): HomeUnit => ({ kind: "article", id, item: item(id), latestAt: "2026-09-19", topicIds: [], reasons: [] });
const page = (topic: string | null = null): HomeNews => ({ mode: "forYou", modeLabel: "Newest first", topic, topics: [], headlines: [], units: [article("one")], nextOffset: null, considered: 1, topicNote: null, snapshot: null, hiddenCount: 0, preferences: 0 });

describe("returning to the feed", () => {
  it("isolates saved filters, bounds cached views, and clears content after access denial", () => {
    const session = new HomeSession();
    const view: SavedLibraryView = { handle: "one", folderPath: "", query: "", state: "bookmarked" };
    const snapshot = { items: [item("one")], nextCursor: "next", scope: { ...savedLibraryScope(view), folderIds: 1 }, scopeFingerprint: "scope" };
    session.saveSavedLibrary(view, snapshot);
    expect(session.getSavedLibrary(view)).toBe(snapshot);
    for (const changed of [{ handle: "two" }, { query: "query" }, { folderPath: "nested" }, { state: "saved" as const }]) {
      expect(session.getSavedLibrary({ ...view, ...changed })).toBeNull();
    }
    for (let index = 0; index < 4; index++) session.saveSavedLibrary({ ...view, query: String(index) }, snapshot);
    expect(session.getSavedLibrary(view)).toBeNull();
    session.saveSavedLibrary(view, { ...snapshot, items: Array.from({ length: 501 }, (_, index) => item(String(index))) });
    expect(session.getSavedLibrary(view)).toBeNull();
    session.setAccessDenied(true);
    expect(session.getSavedLibrary({ ...view, query: "3" })).toBeNull();
  });

  it("removes unkept RSS from saved views while retaining manually saved bookmarks", () => {
    const session = new HomeSession();
    const view: SavedLibraryView = { handle: "one", folderPath: "", query: "", state: "bookmarked" };
    const rows = [{ ...item("rss"), keptReasons: ["keep"] as ReadingListItem["keptReasons"] }, { ...item("manual"), origin: "manual" as const }];
    const snapshot = { items: rows, nextCursor: null, scope: { ...savedLibraryScope(view), folderIds: 1 }, scopeFingerprint: "scope" };
    session.saveSavedLibrary(view, snapshot);
    session.patch(["rss"], (row) => ({ ...row, keptReasons: [] }));
    expect(session.getSavedLibrary(view)?.items.map((row) => row.id)).toEqual(["manual"]);
    expect(snapshot.items).toHaveLength(2);
  });
  it("restores view preferences without sharing them across workspaces", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
    try {
      const session = new HomeSession("one");
      session.saveBookmarks({ folderPath: "bookmarks/research", later: true, query: "climate", search: "climate" });
      session.saveWriting({ folderId: "research", kind: "article", limit: 120 });
      const restored = new HomeSession("one");
      expect(restored.bookmarks).toEqual(session.bookmarks);
      expect(restored.writing).toEqual({ folderId: "research", kind: "article", limit: 60 });
      expect(new HomeSession("two").bookmarks.query).toBe("");
      expect(restored.getTimeline("all")).toBeNull();
      values.set("texttext:views:broken", "invalid JSON");
      expect(new HomeSession("broken").writing.kind).toBe("all");
    } finally { vi.unstubAllGlobals(); }
  });
  it("keeps personal timeline filters separate and clears workspace snapshots", () => {
    const session = new HomeSession();
    const snapshot = { entries: [], nextCursor: "next", snapshot: "2026-09-21T12:00:00.000Z" };
    session.saveTimeline("writing", snapshot);
    expect(session.getTimeline("writing")).toBe(snapshot);
    expect(session.getTimeline("saved")).toBeNull();
    expect(new HomeSession().getTimeline("writing")).toBeNull();
    session.clear();
    expect(session.getTimeline("writing")).toBeNull();
  });
  it("retains each channel and mode independently within this workspace only", () => {
    const session = new HomeSession();
    const otherWorkspace = new HomeSession();
    const forYou = page();
    const latest = { ...page(), mode: "latest" as const };
    session.save(forYou); session.save(latest); session.save(page("channel:Science"));
    expect(session.get(forYou)).toBe(forYou);
    expect(session.get(latest)).toBe(latest);
    expect(otherWorkspace.get(forYou)).toBeNull();
    session.clear();
    expect(session.get(forYou)).toBeNull();
  });

  it("bounds retained views while keeping the last refreshed view", () => {
    const session = new HomeSession();
    for (let i = 0; i < 8; i++) session.save(page(String(i)));
    session.save(page("0")); session.save(page("8"));
    expect(session.get(page("1"))).toBeNull();
    expect(session.get(page("0"))).not.toBeNull();
    expect(session.get(page("8"))).not.toBeNull();
  });

  it("updates saved and read state in articles, grouped coverage and Headlines without changing server snapshots", () => {
    const session = new HomeSession();
    const summary: HomeUnit = { kind: "summary", id: "s", summaryId: "s", headline: "Story", text: null, textStale: false, sources: ["Wire"], sourcePaths: [], members: [item("one"), item("two")], representative: item("one"), imageUrl: null, unread: 2, latestAt: "2026-09-19", coverageRevision: 1, seenRevision: 0, topicIds: [], reasons: [] };
    const snapshot = { ...page(), units: [article("one"), summary], headlines: [summary] };
    session.save(snapshot);
    session.patch(["one"], (row) => ({ ...row, read: true, kept: true, keptReasons: ["keep"] }));
    const changed = session.get(snapshot)!;
    expect(changed.units[0]).toMatchObject({ item: { read: true, keptReasons: ["keep"] } });
    expect(changed.units[1]).toMatchObject({ unread: 1, representative: { read: true } });
    expect(changed.headlines[0]).toMatchObject({ unread: 1, members: [{ read: true }, { read: false }] });
    expect(snapshot.headlines[0]).toMatchObject({ unread: 2, representative: { read: false } });
  });
});
