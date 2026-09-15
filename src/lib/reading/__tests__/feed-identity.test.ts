import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  endpointKey,
  feedEntryKey,
  redactedEndpoint,
  usableFeedDate,
} from "../feed-identity";

describe("canonicalizeUrl (ID-01 canonical URLs)", () => {
  it("strips only known tracking parameters and keeps meaningful ones", () => {
    expect(
      canonicalizeUrl("HTTPS://Example.com:443/a/?utm_source=x&page=2&fbclid=y#top"),
    ).toBe("https://example.com/a?page=2#top");
  });
  it("keeps fragments and non-tracking query strings", () => {
    expect(canonicalizeUrl("https://live.example/blog#entry-7")).toBe(
      "https://live.example/blog#entry-7",
    );
    expect(canonicalizeUrl("https://s.example/?q=rollback&id=9")).toBe(
      "https://s.example/?id=9&q=rollback",
    );
  });
  it("refuses non-http schemes", () => {
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("ftp://x.example/")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
  });
});

describe("feedEntryKey (ID-02 entry identity)", () => {
  it("prefers a declared non-permalink id, verbatim", () => {
    expect(feedEntryKey({ id: "123", idIsPermalink: false, permalink: "https://a.example/123" })).toBe("id:123");
  });
  it("compares permalink guids as URLs", () => {
    const a = feedEntryKey({ id: "http://a.example/p/", idIsPermalink: true });
    const b = feedEntryKey({ id: "http://a.example/p", idIsPermalink: true });
    expect(a).toBe(b);
  });
  it("does not collide an id with a permalink of the same text", () => {
    expect(feedEntryKey({ id: "https://a.example/p", idIsPermalink: false })).not.toBe(
      feedEntryKey({ permalink: "https://a.example/p" }),
    );
  });
  it("falls back to a stable fingerprint without ids or links", () => {
    const first = feedEntryKey({ title: "Hello  World", publishedAt: "2026-09-01" });
    const again = feedEntryKey({ title: "hello world", publishedAt: "2026-09-01" });
    const other = feedEntryKey({ title: "hello world", publishedAt: "2026-09-02" });
    expect(first).toBe(again);
    expect(first).not.toBe(other);
    expect(first.startsWith("fp:")).toBe(true);
  });
});

describe("endpointKey and redactedEndpoint (SRC-03 private endpoints)", () => {
  it("drops credentials and secret parameters from the identity", () => {
    const key = endpointKey("https://user:pw@feeds.example/private.xml?token=abc&format=rss");
    expect(key).toBe("https://feeds.example/private.xml?format=rss");
  });
  it("shows host and path, never a token", () => {
    const shown = redactedEndpoint(
      "https://feeds.example/u/aVeryLongOpaqueTokenSegment_1234567890/feed?key=secret",
    );
    expect(shown).not.toContain("secret");
    expect(shown).not.toContain("aVeryLongOpaqueTokenSegment_1234567890");
    expect(shown).toContain("feeds.example/u/aVer");
    expect(shown).toContain("(private)");
  });
});

describe("usableFeedDate (ING-06 dates)", () => {
  const now = new Date("2026-09-15T00:00:00Z");
  it("accepts ordinary dates and rejects garbage", () => {
    expect(usableFeedDate("Mon, 01 Sep 2026 10:00:00 GMT", now)?.toISOString()).toBe(
      "2026-09-01T10:00:00.000Z",
    );
    expect(usableFeedDate("yesterday-ish", now)).toBeNull();
    expect(usableFeedDate(null, now)).toBeNull();
  });
  it("rejects far-future and pre-web dates so they cannot pin the list", () => {
    expect(usableFeedDate("2030-01-01T00:00:00Z", now)).toBeNull();
    expect(usableFeedDate("1980-01-01T00:00:00Z", now)).toBeNull();
  });
});
