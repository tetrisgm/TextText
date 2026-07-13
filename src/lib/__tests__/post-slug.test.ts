import { describe, expect, it } from "vitest";
import {
  POST_SLUG_MAX_LENGTH,
  classifySlugCandidates,
  isSafePostSlug,
  sanitizePostSlug,
} from "@/lib/post-slug";

type Row = {
  id: string;
  slug: string;
  slugHistory: string[];
  deletedAt: Date | null;
};

function row(
  id: string,
  slug: string,
  slugHistory: string[] = [],
  deletedAt: Date | null = null,
): Row {
  return { id, slug, slugHistory, deletedAt };
}

describe("classifySlugCandidates", () => {
  it("prefers a live exact slug over historical aliases", () => {
    const result = classifySlugCandidates("reclaimed", [
      row("old", "new-place", ["reclaimed"]),
      row("new", "reclaimed"),
    ]);
    expect(result).toEqual({ kind: "exact", row: row("new", "reclaimed") });
  });

  it("treats a trashed exact slug as a tombstone", () => {
    const result = classifySlugCandidates("reserved", [
      row("trashed", "reserved", [], new Date("2026-07-13T00:00:00Z")),
      row("old", "elsewhere", ["reserved"]),
    ]);
    expect(result).toEqual({ kind: "tombstone" });
  });

  it("resolves one live historical owner", () => {
    const owner = row("post", "current", ["previous", "first"]);
    expect(classifySlugCandidates("previous", [owner])).toEqual({
      kind: "history",
      row: owner,
    });
  });

  it("fails closed when more than one live post owns an alias", () => {
    expect(
      classifySlugCandidates("shared", [
        row("one", "one-current", ["shared"]),
        row("two", "two-current", ["shared"]),
      ]),
    ).toEqual({ kind: "ambiguous" });
  });

  it("ignores historical aliases on trashed posts", () => {
    expect(
      classifySlugCandidates("old", [
        row("trashed", "current", ["old"], new Date()),
      ]),
    ).toEqual({ kind: "missing" });
  });
});

describe("post route slugs", () => {
  it("normalizes route delimiters, controls, and encoded separators", () => {
    expect(sanitizePostSlug("What??", "fallback")).toBe("what");
    expect(
      sanitizePostSlug("Folder/name?view#part\u0000tail", "fallback"),
    ).toBe("folder-name-view-part-tail");
    expect(
      sanitizePostSlug("encoded%2Fslash%5Cbackslash", "fallback"),
    ).toBe("encoded-2fslash-5cbackslash");
  });

  it("caps oversized values and sanitizes the fallback too", () => {
    const oversized = sanitizePostSlug("X".repeat(200), "fallback");
    expect(oversized).toHaveLength(POST_SLUG_MAX_LENGTH);
    expect(oversized).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(sanitizePostSlug("???", "Unsafe/Fallback??")).toBe(
      "unsafe-fallback",
    );
  });

  it("recognizes only canonical safe route slugs", () => {
    expect(isSafePostSlug("safe-post-2")).toBe(true);
    for (const unsafe of [
      "Safe-post",
      "safe/post",
      "safe?post",
      "safe#post",
      "safe%2Fpost",
      `safe\u0000post`,
      "x".repeat(POST_SLUG_MAX_LENGTH + 1),
    ]) {
      expect(isSafePostSlug(unsafe)).toBe(false);
    }
  });
});
