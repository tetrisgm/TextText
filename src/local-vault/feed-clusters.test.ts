import { describe, expect, it } from "vitest";
import { clusterFeedStories, type FeedStory } from "./feed-clusters";

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
});
