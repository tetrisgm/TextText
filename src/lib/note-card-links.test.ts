import { describe, expect, it } from "vitest";
import { noteCardHref, noteCardIdFromHref } from "./note-card-links";

describe("note card links", () => {
  it("stores a stable TextPack identity in a safe fragment", () => {
    const id = "d6090b67-e3bb-46a3-9d34-76061bcb1dbb";
    expect(noteCardIdFromHref(noteCardHref(id))).toBe(id);
    expect(noteCardIdFromHref("#texttext-card=../bad")).toBeNull();
    expect(noteCardIdFromHref("https://example.com/#texttext-card=" + id)).toBeNull();
    expect(() => noteCardHref("../bad")).toThrow("Invalid card identity");
  });
});
