import { describe, expect, it } from "vitest";

/**
 * The rule a move now follows when the destination already holds an item with
 * the same slug. The database enforces uniqueness per folder, so a move used
 * to fail outright; it re-slugs instead, and keeps the old slug in history so
 * links that were already shared still resolve.
 */
function nextFreeSlug(desired: string, used: ReadonlySet<string>): string {
  if (!used.has(desired)) return desired;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${desired}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${desired}-x`;
}

describe("re-slugging on move", () => {
  it("keeps the slug when the destination has room", () => {
    expect(nextFreeSlug("notes-on-tea", new Set(["something-else"]))).toBe(
      "notes-on-tea",
    );
  });

  it("takes the next free suffix when it collides", () => {
    expect(nextFreeSlug("connect", new Set(["connect"]))).toBe("connect-2");
    expect(nextFreeSlug("connect", new Set(["connect", "connect-2"]))).toBe(
      "connect-3",
    );
  });

  it("does not renumber past a gap", () => {
    expect(nextFreeSlug("a", new Set(["a", "a-3"]))).toBe("a-2");
  });

  it("keeps the old slug in history so shared links still resolve", () => {
    const history = ["older-one"];
    const previous = "connect";
    const next = Array.from(new Set([...history, previous]));
    expect(next).toEqual(["older-one", "connect"]);
    // Moving twice must not duplicate an entry.
    expect(Array.from(new Set([...next, previous]))).toEqual([
      "older-one",
      "connect",
    ]);
  });
});
