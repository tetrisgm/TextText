import { describe, expect, it } from "vitest";
import { freshness, rankCandidates, scoreCandidate, snapshotId, type RankCandidate, type RankPreferences } from "../rank";

const now = Date.UTC(2026, 8, 17, 12, 0, 0);
const hoursAgo = (hours: number) => new Date(now - hours * 3600_000).toISOString();
const none: RankPreferences = { topicMore: new Set(), topicLess: new Set(), sourceLess: new Set() };
function candidate(id: string, extra: Partial<RankCandidate> = {}): RankCandidate {
  return { id, latestAt: hoursAgo(1), sources: ["Wire"], sourcePaths: ["bookmarks/wire"], topicIds: [], coverageRevision: 1, seenRevision: 0, affinity: null, ...extra };
}

describe("freshness", () => {
  it("is 1 now, falls through the day, and is 0 at the horizon", () => {
    expect(freshness(hoursAgo(0), now)).toBe(1);
    expect(freshness(hoursAgo(12), now)).toBeGreaterThan(freshness(hoursAgo(48), now));
    expect(freshness(hoursAgo(24 * 7), now)).toBe(0);
    expect(freshness(hoursAgo(24 * 30), now)).toBe(0);
  });
});

describe("scoreCandidate", () => {
  it("names every term that fired", () => {
    const { terms } = scoreCandidate(candidate("a", { sources: ["Wire", "Daily", "Post"], topicIds: ["derived:1"], coverageRevision: 3, seenRevision: 2, affinity: 0.5 }), { ...none, topicMore: new Set(["derived:1"]) }, now);
    expect(terms.map((term) => term.name)).toEqual(["fresh", "new coverage", "your interest", "like what you keep", "several sources"]);
  });

  it("marks seen repetition and reductions, and reduces a mixed-source unit by its share", () => {
    const seen = scoreCandidate(candidate("a", { coverageRevision: 2, seenRevision: 2 }), none, now);
    expect(seen.terms.find((term) => term.name === "already seen")?.value).toBe(-2);
    const mixed = scoreCandidate(candidate("b", { sources: ["Wire", "Daily"], sourcePaths: ["bookmarks/wire", "bookmarks/daily"] }), { ...none, sourceLess: new Set(["bookmarks/wire"]) }, now);
    expect(mixed.terms.find((term) => term.name === "less of this")?.value).toBe(-1);
    const topic = scoreCandidate(candidate("c", { topicIds: ["derived:9"] }), { ...none, topicLess: new Set(["derived:9"]) }, now);
    expect(topic.terms.find((term) => term.name === "less of this")?.value).toBe(-2);
  });

  it("never treats unread as a preference or a first sight as a repeat", () => {
    const first = scoreCandidate(candidate("a"), none, now);
    expect(first.terms.map((term) => term.name)).toEqual(["fresh"]);
  });
});

describe("rankCandidates", () => {
  it("is deterministic and contrasting preferences change the order over one corpus", () => {
    const corpus = [
      candidate("rust", { topicIds: ["derived:rust"], latestAt: hoursAgo(6) }),
      candidate("cars", { topicIds: ["derived:cars"], latestAt: hoursAgo(5) }),
      candidate("garden", { topicIds: ["derived:garden"], latestAt: hoursAgo(4) }),
    ];
    const plain = rankCandidates(corpus, none, now).map((entry) => entry.candidate.id);
    expect(plain).toEqual(["garden", "cars", "rust"]);
    expect(rankCandidates(corpus, none, now).map((entry) => entry.candidate.id)).toEqual(plain);
    const rustFan = rankCandidates(corpus, { ...none, topicMore: new Set(["derived:rust"]) }, now).map((entry) => entry.candidate.id);
    expect(rustFan[0]).toBe("rust");
    const noCars = rankCandidates(corpus, { ...none, topicLess: new Set(["derived:cars"]) }, now).map((entry) => entry.candidate.id);
    expect(noCars[2]).toBe("cars");
    // Reversal: removing the rule restores the plain order.
    expect(rankCandidates(corpus, none, now).map((entry) => entry.candidate.id)).toEqual(plain);
    expect(snapshotId(plain)).not.toBe(snapshotId(rustFan));
    expect(snapshotId(plain)).toBe(snapshotId([...plain]));
  });

  it("keeps the top of the list varied: a source cannot fill the head while others are waiting", () => {
    const corpus = [
      ...Array.from({ length: 8 }, (_, index) => candidate(`w${index}`, { sources: ["Wire"], latestAt: hoursAgo(index) })),
      ...Array.from({ length: 6 }, (_, index) => candidate(`d${index}`, { sources: ["Daily"], sourcePaths: ["bookmarks/daily"], latestAt: hoursAgo(10 + index) })),
      ...Array.from({ length: 6 }, (_, index) => candidate(`p${index}`, { sources: ["Post"], sourcePaths: ["bookmarks/post"], latestAt: hoursAgo(20 + index) })),
    ];
    const order = rankCandidates(corpus, none, now).map((entry) => entry.candidate);
    const head = order.slice(0, 9);
    expect(head.filter((entry) => entry.sources[0] === "Wire")).toHaveLength(3);
    expect(head.filter((entry) => entry.sources[0] === "Daily")).toHaveLength(3);
    expect(head.filter((entry) => entry.sources[0] === "Post")).toHaveLength(3);
    expect(order).toHaveLength(20);
    expect(new Set(order.map((entry) => entry.id)).size).toBe(20);
  });
});
