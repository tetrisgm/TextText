import { describe, expect, it } from "vitest";
import { noteCardBacklinkExcerpt, noteCardHref, noteCardIdFromHref } from "./note-card-links";

describe("note card links", () => {
  it("stores a stable TextPack identity in a safe fragment", () => {
    const id = "d6090b67-e3bb-46a3-9d34-76061bcb1dbb";
    expect(noteCardIdFromHref(noteCardHref(id))).toBe(id);
    expect(noteCardIdFromHref("#texttext-card=../bad")).toBeNull();
    expect(noteCardIdFromHref("https://example.com/#texttext-card=" + id)).toBeNull();
    expect(() => noteCardHref("../bad")).toThrow("Invalid card identity");
  });
  it("finds the linking line and ignores plain mentions or other cards", () => {
    const id = "card-123";
    expect(noteCardBacklinkExcerpt("a note\nRelated [card](<#texttext-card=card-123>) here", id)).toBe("Related card here");
    expect(noteCardBacklinkExcerpt("plain #texttext-card=card-123", id)).toBeNull();
    expect(noteCardBacklinkExcerpt("[other](<#texttext-card=card-1234>)", id)).toBeNull();
  });
});
