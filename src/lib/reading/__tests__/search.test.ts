import { describe, expect, it } from "vitest";
import { fuseRanks, searchTokens, snippetFor } from "../search.server";
import { embeddingText, normalize } from "../embeddings.server";

describe("reading search primitives", () => {
  it("tokenizes on letters and digits, deduplicates, and drops one-character noise", () => {
    expect(searchTokens("Rollback, rollback: a GPU driver for M4")).toEqual(["rollback", "gpu", "driver", "for", "m4"]);
  });

  it("fuses lexical and semantic ranks so an item found by both leads, and says which side found each", () => {
    const fused = fuseRanks(["a", "b", "c"], ["c", "d"]);
    expect(fused[0]).toMatchObject({ id: "c", match: "both" });
    // b and d tie on score (one rank-2 hit each); ties break on id so the order is stable.
    expect(fused.map((entry) => entry.id)).toEqual(["c", "a", "b", "d"]);
    expect(fused.find((entry) => entry.id === "a")?.match).toBe("lexical");
    expect(fused.find((entry) => entry.id === "d")?.match).toBe("semantic");
  });

  it("keeps a lexical-only run stable when the semantic side is empty", () => {
    expect(fuseRanks(["x", "y"], []).map((entry) => entry.id)).toEqual(["x", "y"]);
  });

  it("snips around the first token hit and marks the cut edges", () => {
    const text = `${"lead ".repeat(40)}the rollback story continues ${"tail ".repeat(40)}`;
    const snippet = snippetFor(text, ["rollback"], 60);
    expect(snippet.startsWith("...")).toBe(true);
    expect(snippet.endsWith("...")).toBe(true);
    expect(snippet).toContain("rollback");
    expect(snippet.length).toBeLessThanOrEqual(66);
  });

  it("normalizes vectors to unit length and tolerates a zero vector", () => {
    const unit = normalize([3, 4]);
    expect(unit[0]).toBeCloseTo(0.6);
    expect(unit[1]).toBeCloseTo(0.8);
    expect(normalize([0, 0])).toEqual([0, 0]);
  });

  it("bounds the indexed text and leads with the title", () => {
    const text = embeddingText({ title: "Title", excerpt: "Excerpt", body: "b".repeat(10_000) });
    expect(text.startsWith("Title\n\nExcerpt\n\nbbb")).toBe(true);
    expect(text.length).toBe(6000);
  });
});

import { parseReadingQuery } from "../search.server";

describe("reading query operators", () => {
  it("separates operators, phrases, and free text", () => {
    const parsed = parseReadingQuery('feed:"Hacker News" is:unread is:starred before:2026-09-10 after:2026-09-01 "gpu driver" rollback');
    expect(parsed).toMatchObject({ feed: "Hacker News", unread: true, starred: true, kept: false, text: "rollback", phrases: ["gpu driver"] });
    expect(parsed.before?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(parsed.after?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("keeps unknown operators and bad dates as text", () => {
    const parsed = parseReadingQuery("re:thing before:yesterday is:kept");
    expect(parsed.text).toBe("re:thing before:yesterday");
    expect(parsed.kept).toBe(true);
    expect(parsed.before).toBeNull();
  });
});
