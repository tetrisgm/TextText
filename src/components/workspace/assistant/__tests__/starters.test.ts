// The starters are the first thing anybody sees in the rail, so the things that
// would embarrass us are: a greeting that lies about the time, a starter that
// names a document with someone's whole first paragraph, and a context we
// forgot to cover falling through to nothing.

import { describe, expect, it } from "vitest";
import {
  greeting,
  greetingPhrase,
  startersFor,
  type StarterContextLevel,
} from "../starters";

describe("greeting", () => {
  it("matches the reader's clock, including after midnight", () => {
    expect(greetingPhrase(0)).toBe("Good evening");
    expect(greetingPhrase(4)).toBe("Good evening");
    expect(greetingPhrase(5)).toBe("Good morning");
    expect(greetingPhrase(11)).toBe("Good morning");
    expect(greetingPhrase(12)).toBe("Good afternoon");
    expect(greetingPhrase(17)).toBe("Good afternoon");
    expect(greetingPhrase(18)).toBe("Good evening");
    expect(greetingPhrase(23)).toBe("Good evening");
  });

  it("uses the first name only", () => {
    const afternoon = new Date(2026, 7, 11, 14, 0, 0);
    expect(greeting("Ramine Darabiha", afternoon)).toBe("Good afternoon, Ramine");
  });

  it("drops the comma rather than greeting nobody", () => {
    const afternoon = new Date(2026, 7, 11, 14, 0, 0);
    for (const name of [null, undefined, "", "   "]) {
      expect(greeting(name, afternoon)).toBe("Good afternoon");
    }
  });
});

describe("starters", () => {
  const levels: StarterContextLevel[] = ["item", "folder", "trash", "shared", "root"];

  it("offers something everywhere, and never more than three", () => {
    for (const level of levels) {
      const starters = startersFor({ level });
      expect(starters.length).toBeGreaterThan(0);
      expect(starters.length).toBeLessThanOrEqual(3);
      for (const starter of starters) {
        expect(starter.label.trim()).not.toBe("");
        expect(starter.prompt.trim()).not.toBe("");
      }
    }
  });

  it("names the document it is looking at", () => {
    const [first] = startersFor({ level: "item", label: "The Invisible Hand of Super Metroid" });
    expect(first.label).toContain("Super Metroid");
  });

  it("stays a single line when the title is a paragraph", () => {
    const title = "A very long title that somebody pasted in whole and never trimmed down at all";
    const [first] = startersFor({ level: "item", label: title });
    expect(first.label.length).toBeLessThan(80);
    expect(first.label).toContain("…");
  });

  it("falls back to a generic label rather than an empty one", () => {
    for (const label of [null, undefined, ""]) {
      const [first] = startersFor({ level: "item", label });
      expect(first.label).toBe("Sharpen my writing here");
    }
  });

  it("asks about the collection by name", () => {
    const [first] = startersFor({ level: "folder", label: "Bookmarks" });
    expect(first.label).toBe("What is in Bookmarks?");
  });
});

describe("mapping the composer's context chip", () => {
  it("treats an item as an item and keeps its title", async () => {
    const { starterContextFromChip } = await import("../starters");
    expect(starterContextFromChip({ kind: "item", label: "Super Metroid" })).toEqual({
      level: "item",
      label: "Super Metroid",
    });
  });

  it("does not offer to sharpen the writing in Trash", async () => {
    const { starterContextFromChip } = await import("../starters");
    expect(starterContextFromChip({ kind: "folder", label: "Trash" })).toEqual({ level: "trash" });
    expect(starterContextFromChip({ kind: "folder", label: "Shared with me" })).toEqual({
      level: "shared",
    });
  });

  it("falls back to the workspace when the chip says nothing", async () => {
    const { starterContextFromChip } = await import("../starters");
    expect(starterContextFromChip({}).level).toBe("root");
  });
});
