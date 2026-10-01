import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gate: vi.fn(), fetch: vi.fn(), discover: vi.fn() }));
vi.mock("@/lib/bookmark-fetch", () => ({ isFetchableBookmarkUrl: mocks.gate }));
vi.mock("@/lib/reading/fetch.server", () => ({ fetchFeedDocument: mocks.fetch, discoverFeedCandidates: mocks.discover }));
import { discoverVaultFeeds, readVaultFeed, readVaultFeedEntry, VaultFeedError } from "./rss-feed.server";

const rss = `<rss><channel><title>Daily</title><link>https://publisher.example/</link>
  <item><guid isPermaLink="false">entry-one</guid><title>One</title><link>https://publisher.example/one</link>
  <description><![CDATA[<p>Saved source text.</p>]]></description></item></channel></rss>`;

describe("transient vault feed reads", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.gate.mockReturnValue(true); });

  it("uses the gated fetch and normalized parser without writing an item", async () => {
    mocks.fetch.mockResolvedValue({ kind: "ok", body: rss, contentType: "application/rss+xml", finalUrl: "https://publisher.example/feed" });
    const result = await readVaultFeed("https://publisher.example/feed");
    expect(mocks.fetch).toHaveBeenCalledWith("https://publisher.example/feed");
    expect(result.title).toBe("Daily");
    expect(result.entries).toMatchObject([{ externalKey: "id:entry-one", bodyPreview: "Saved source text." }]);
    expect("bodyMarkdown" in result.entries[0]).toBe(false);
    expect(result.availableCount).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("rejects unsafe addresses before fetch and gives bounded public failures", async () => {
    mocks.gate.mockReturnValue(false);
    await expect(readVaultFeed("http://127.0.0.1/feed")).rejects.toMatchObject({ status: 400 });
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.gate.mockReturnValue(true);
    mocks.fetch.mockResolvedValue({ kind: "error", reason: "network", detail: "private diagnostic" });
    await expect(readVaultFeed("https://publisher.example/feed")).rejects.toThrow("The feed could not be reached.");
    try { await readVaultFeed("https://publisher.example/feed"); }
    catch (error) { expect(error).toBeInstanceOf(VaultFeedError); expect((error as Error).message).not.toContain("private diagnostic"); }
  });

  it("returns only verified, public discovery candidates", async () => {
    mocks.discover.mockResolvedValue({ pageTitle: "Publisher", detail: null, candidates: [
      { url: "https://publisher.example/feed", title: "Posts", verified: true },
      { url: "https://publisher.example/guess", title: "Guess", verified: false },
      { url: "https://user:password@publisher.example/private", title: "Private", verified: true },
    ] });
    const result = await discoverVaultFeeds("publisher.example");
    expect(mocks.discover).toHaveBeenCalledWith("https://publisher.example/");
    expect(result.candidates).toMatchObject([{ url: "https://publisher.example/feed", title: "Posts", verified: true }]);
  });

  it("keeps a large feed list small and refetches the complete selected entry", async () => {
    const body = "x".repeat(70_000);
    const feed = JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "Large feed",
      items: Array.from({ length: 100 }, (_, index) => ({ id: `entry-${index}`, title: `Article ${index}`,
        url: `https://publisher.example/${index}`, content_text: body })) });
    mocks.fetch.mockResolvedValue({ kind: "ok", body: feed, contentType: "application/feed+json", finalUrl: "https://publisher.example/feed" });
    const list = await readVaultFeed("https://publisher.example/feed");
    expect(list.entries).toHaveLength(100);
    expect(new TextEncoder().encode(JSON.stringify(list)).byteLength).toBeLessThanOrEqual(2_000_000);
    expect(list.entries[42]).toMatchObject({ externalKey: "id:entry-42", bodyPreview: "x".repeat(512) });
    expect("bodyMarkdown" in list.entries[42]).toBe(false);
    const full = await readVaultFeedEntry("https://publisher.example/feed", list.entries[42].externalKey);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(full.entry.bodyMarkdown).toBe(body);
    expect(new TextEncoder().encode(JSON.stringify(full)).byteLength).toBeLessThanOrEqual(2_000_000);
  });

  it("refuses a stale entry key after a fresh gated read", async () => {
    mocks.fetch.mockResolvedValue({ kind: "ok", body: rss, contentType: "application/rss+xml", finalUrl: "https://publisher.example/feed" });
    await expect(readVaultFeedEntry("https://publisher.example/feed", "id:missing")).rejects.toMatchObject({ status: 404 });
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});
