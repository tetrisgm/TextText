import { describe, expect, it } from "vitest";
import { findReaderTextMatches } from "@/components/workspace/ReaderFindHighlights";

describe("findReaderTextMatches", () => {
  it("finds every case-insensitive, non-overlapping match", () => {
    expect(findReaderTextMatches("Reader text, reader tools", "READER")).toEqual([
      { start: 0, end: 6 },
      { start: 13, end: 19 },
    ]);
  });

  it("ignores an empty query", () => {
    expect(findReaderTextMatches("Reader text", "   ")).toEqual([]);
  });
});
