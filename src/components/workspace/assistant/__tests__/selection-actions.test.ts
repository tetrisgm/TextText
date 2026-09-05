// The toolbar's failure modes are all geometric or trivial-selection: it sits
// off the top of the window, it hangs off the right edge, or it appears for a
// stray click. None of those are visible until somebody selects in the wrong
// place, so they are pinned here.

import { describe, expect, it } from "vitest";
import {
  SELECTION_ACTIONS,
  anchorFor,
  isActionableSelection,
} from "../SelectionActions";

const toolbar = { width: 220, height: 40, gap: 8 };
const viewport = { width: 1200 };

describe("where the toolbar sits", () => {
  it("centres above the selection when there is room", () => {
    const anchor = anchorFor({ left: 500, right: 700, top: 300, width: 200 }, viewport, toolbar);
    expect(anchor.left).toBe(500 + 100 - 110);
    expect(anchor.top).toBe(300 - 40 - 8);
  });

  it("drops below rather than off the top of the window", () => {
    const anchor = anchorFor({ left: 500, right: 700, top: 10, width: 200 }, viewport, toolbar);
    expect(anchor.top).toBeGreaterThan(10);
  });

  it("stays on screen at either edge", () => {
    const left = anchorFor({ left: 0, right: 40, top: 300, width: 40 }, viewport, toolbar);
    expect(left.left).toBeGreaterThanOrEqual(toolbar.gap);

    const right = anchorFor({ left: 1180, right: 1200, top: 300, width: 20 }, viewport, toolbar);
    expect(right.left + toolbar.width).toBeLessThanOrEqual(viewport.width);
  });

  it("survives a viewport narrower than the toolbar", () => {
    const anchor = anchorFor({ left: 10, right: 90, top: 300, width: 80 }, { width: 180 }, toolbar);
    expect(Number.isFinite(anchor.left)).toBe(true);
    expect(anchor.left).toBeGreaterThanOrEqual(0);
  });
});

describe("when it appears at all", () => {
  it("ignores a stray click or a single character", () => {
    for (const value of [null, undefined, "", " ", "\n", "a"]) {
      expect(isActionableSelection(value)).toBe(false);
    }
  });

  it("offers itself for real text", () => {
    expect(isActionableSelection("no")).toBe(true);
    expect(isActionableSelection("  a sentence worth rewriting  ")).toBe(true);
  });
});

describe("what it offers", () => {
  it("only offers actions that mean something about a passage", () => {
    const ids = SELECTION_ACTIONS.map((action) => action.id);
    expect(ids).toEqual(["rewrite", "summarize", "excerpt", "translate", "continue"]);
    // "title" and "tags" are about the whole item, not the selection.
    expect(ids).not.toContain("title");
    expect(ids).not.toContain("tags");
  });
});
