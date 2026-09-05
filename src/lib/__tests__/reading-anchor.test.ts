import { describe, expect, it } from "vitest";
import { offsetOfReadingAnchor } from "../reading-anchor";

const source = [
  "# Title",
  "",
  "First paragraph with a [link](https://example.com) inside.",
  "",
  "**Web Summit**, 13 - 16 Nov 2023 is our flagship event in Lisbon.",
  "",
  "Plain closing paragraph.",
].join("\n");

describe("offsetOfReadingAnchor", () => {
  it("finds plain text at its source offset", () => {
    const at = offsetOfReadingAnchor(source, "Plain closing paragraph.");
    expect(source.slice(at, at + 5)).toBe("Plain");
  });
  it("finds text whose source carries emphasis", () => {
    const at = offsetOfReadingAnchor(source, "Web Summit, 13 - 16 Nov 2023 is our flagship");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(source.slice(at, at + 14)).toMatch(/^\*\*Web Summit|^Web Summit/);
  });
  it("returns -1 when nothing matches", () => {
    expect(offsetOfReadingAnchor(source, "not in this document at all")).toBe(-1);
  });
});
