import { describe, expect, it } from "vitest";
import { writingKind } from "../writing";

describe("writing destinations", () => {
  it("follows note and article presentation without changing legacy identity", () => {
    expect(writingKind({ type: "note", template: { id: "texttext.article", version: 1 } })).toBe("article");
    expect(writingKind({ type: "article", template: { id: "texttext.note", version: 1 } })).toBe("note");
    expect(writingKind({ type: "note" })).toBe("note");
  });
  it("keeps feeds and saved sources out of authored writing regardless of look", () => {
    expect(writingKind({ type: "article", origin: "feed", template: { id: "texttext.article", version: 1 } })).toBeNull();
    expect(writingKind({ type: "bookmark", template: { id: "texttext.note", version: 1 } })).toBeNull();
  });
  it("keeps custom types in Everything without calling them notes", () => {
    expect(writingKind({ type: "note", template: { id: "book-review", version: 2 } })).toBe("custom");
  });
});
