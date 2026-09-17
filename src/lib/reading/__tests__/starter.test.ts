import { describe, expect, it } from "vitest";
import { STARTER_ACTION, STARTER_FEEDS, STARTER_STARTED, starterTopics } from "../starter-feeds";

/**
 * The starter set is the difference between a news surface and an empty
 * screen, so the list itself is worth holding still: every entry needs a name
 * a person recognises, an https endpoint, and a topic, and none of them may
 * appear twice.
 */

describe("the starter sources", () => {
  it("is a set a workspace can actually open with", () => {
    expect(STARTER_FEEDS.length).toBeGreaterThanOrEqual(12);
    expect(starterTopics().length).toBeGreaterThanOrEqual(4);
  });

  it("names every feed, over https, once", () => {
    const urls = new Set<string>();
    const names = new Set<string>();
    for (const feed of STARTER_FEEDS) {
      expect(feed.name.trim(), JSON.stringify(feed)).not.toBe("");
      expect(feed.topic.trim(), feed.name).not.toBe("");
      expect(feed.url, feed.name).toMatch(/^https:\/\//);
      expect(feed.site, feed.name).toMatch(/^https:\/\//);
      expect(urls.has(feed.url), `duplicate url ${feed.url}`).toBe(false);
      // The folder name is how a part-finished set is resumed, so two feeds
      // may never share one.
      expect(names.has(feed.name), `duplicate name ${feed.name}`).toBe(false);
      urls.add(feed.url);
      names.add(feed.name);
    }
  });

  it("keeps the two ledger actions apart", () => {
    expect(STARTER_STARTED).not.toBe(STARTER_ACTION);
    expect(STARTER_STARTED.startsWith("reading.")).toBe(true);
    expect(STARTER_ACTION.startsWith("reading.")).toBe(true);
  });
});
