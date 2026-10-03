import { describe, expect, it } from "vitest";
import { clusterFeedStories, rankFeedClusters, type FeedStory } from "./feed-clusters";

const story = (overrides: Partial<FeedStory> = {}): FeedStory => ({
  externalKey: "a", title: "City approves a new waterfront transit plan", permalink: "https://one.example/story",
  publishedAt: "2026-10-02T12:00:00Z", excerpt: null, imageUrl: null,
  source: "One", feedURL: "https://one.example/feed", topic: "World", ...overrides,
});

describe("feed coverage groups", () => {
  it("groups cross-publisher coverage with related headlines inside three days", () => {
    const groups = clusterFeedStories([
      story(),
      story({ externalKey: "b", title: "New waterfront transit plan approved by city", permalink: "https://two.example/different", source: "Two", feedURL: "https://two.example/feed", publishedAt: "2026-10-03T12:00:00Z" }),
      story({ externalKey: "c", title: "New waterfront transit plan approved by city", permalink: "https://two.example/another", source: "Two", feedURL: "https://two.example/feed", publishedAt: "2026-09-20T12:00:00Z" }),
    ]);
    expect(groups.map(group => group.members.length)).toEqual([2, 1]);
    expect(groups[0].sources).toEqual(["Two", "One"]);
  });

  it("groups a shared canonical URL while keeping unrelated and same-source titles separate", () => {
    const groups = clusterFeedStories([
      story(),
      story({ externalKey: "b", title: "Completely different headline", permalink: "https://one.example/story?utm_source=newsletter#section", source: "Two", feedURL: "https://two.example/feed" }),
      story({ externalKey: "c", permalink: "https://one.example/other", publishedAt: "2026-10-02T13:00:00Z" }),
      story({ externalKey: "d", title: "Different subject entirely", permalink: "https://other.example/unrelated", source: "Three", feedURL: "https://three.example/feed" }),
    ]);
    expect(groups.map(group => group.members.length)).toEqual([2, 1, 1]);
  });

  it("ranks fresh independent coverage and diversifies the first screen", () => {
    const now = Date.parse("2026-10-02T15:00:00Z");
    const fresh = story({ externalKey: "fresh", title: "Fresh independent coverage of local transit", source: "One", permalink: "https://one.example/fresh" });
    const corroboration = story({ externalKey: "same", title: fresh.title, source: "Two", feedURL: "https://two.example/feed", permalink: "https://two.example/fresh" });
    const old = story({ externalKey: "old", title: "An unrelated old story about transit", publishedAt: "2026-09-20T12:00:00Z", permalink: "https://one.example/old" });
    const ranked = rankFeedClusters(clusterFeedStories([old, fresh, corroboration]), now);
    expect(ranked[0].members).toHaveLength(2);
    expect(ranked[1].members).toHaveLength(1);
    const many = Array.from({ length: 5 }, (_, index) => story({ externalKey: `one-${index}`, title: `Unique local headline number ${index}`, permalink: `https://one.example/${index}` }));
    const other = story({ externalKey: "other", title: "A different story from another publisher", source: "Two", feedURL: "https://two.example/feed", permalink: "https://two.example/other" });
    const diverse = rankFeedClusters(clusterFeedStories([...many, other]), now);
    expect(diverse.findIndex(group => group.members[0].source === "Two")).toBeLessThan(4);
  });
  it("demotes a topic without removing its stories", () => {
    const now = Date.parse("2026-10-02T15:00:00Z");
    const design = story({ externalKey: "design", title: "A new design story", topic: "Design", permalink: "https://one.example/design" });
    const world = story({ externalKey: "world", title: "A new world story", source: "Two", feedURL: "https://two.example/feed", permalink: "https://two.example/world" });
    const groups = clusterFeedStories([design, world]);
    expect(rankFeedClusters(groups, now, new Set(["design"])).map(group => group.members[0].topic)).toEqual(["World", "Design"]);
  });
});
