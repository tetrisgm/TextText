import { describe, expect, it } from "vitest";
import { HomeSession } from "../session";
import type { HomeNews, HomeUnit, ReadingListItem } from "@/lib/reading/client";

const item = (id: string): ReadingListItem => ({ id, origin: "feed", title: id, publisherTitle: "Wire", publisherName: "Wire", folderId: "f", folderPath: "bookmarks/wire", sourceFolderName: "Wire", permalink: null, externalUrl: null, publishedAt: null, receivedAt: "2026-09-19", availability: "full", imageUrl: null, wordCount: 100, excerpt: null, authors: [], read: false, starred: false, kept: false, keptReasons: [], expiresAt: null, slug: id, cursor: id });
const article = (id: string): HomeUnit => ({ kind: "article", id, item: item(id), latestAt: "2026-09-19", topicIds: [], reasons: [] });
const page = (topic: string | null = null): HomeNews => ({ mode: "forYou", modeLabel: "Newest first", topic, topics: [], headlines: [], units: [article("one")], nextOffset: null, considered: 1, topicNote: null, snapshot: null, hiddenCount: 0, preferences: 0 });

describe("returning to the feed", () => {
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
