import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gate: vi.fn(), fetch: vi.fn(), discover: vi.fn() }));
vi.mock("@/lib/bookmark-fetch", () => ({ isFetchableBookmarkUrl: mocks.gate }));
vi.mock("@/lib/reading/fetch.server", () => ({ fetchFeedDocument: mocks.fetch, discoverFeedCandidates: mocks.discover }));
import { discoverVaultFeeds, readVaultFeed, VaultFeedError } from "./rss-feed.server";

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
    expect(result.entries).toMatchObject([{ externalKey: "id:entry-one", bodyMarkdown: "Saved source text." }]);
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
});
