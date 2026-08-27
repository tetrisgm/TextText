import { describe, expect, it } from "vitest";
import {
  segmentsForValue,
  type Segment,
} from "@/components/document/MarkdownSurface";

/**
 * The one property that keeps the writing surface safe to change.
 *
 * The surface styles markdown with its own regexes, which is a SECOND
 * implementation next to the reader's remark pipeline, and the two will drift:
 * the reader knows tables, strikethrough and footnotes that these regexes do
 * not. That drift is cosmetic, and only cosmetic, for exactly as long as this
 * holds: the segments concatenate back to the input, character for character.
 *
 * Everything downstream is absolute character offsets into that same string.
 * The agent edits by range against expected text, the Y.Text holds it, remote
 * carets are offsets, `if_match_hash` hashes it, and the surface hides syntax
 * by CSS precisely so the characters stay. A segmenter that drops or invents
 * one character moves every one of those while the document still looks right,
 * which is the worst way for this to fail.
 *
 * So this is a property test, not a list of examples: new markdown constructs
 * are covered the day they are added, whether or not anyone remembers to style
 * them.
 */
function joined(segments: Segment[]): string {
  return segments.map((segment) => segment.text).join("");
}

const CONSTRUCTS = [
  "",
  "plain",
  "# One",
  "###### Six",
  "#NoSpace",
  "  ## Indented",
  "## Trailing spaces   ",
  "> quoted",
  ">no space",
  "- bullet",
  "* star",
  "+ plus",
  "1. ordered",
  "10. ordered ten",
  "- [ ] task",
  "- [x] done",
  "**strong**",
  "__strong__",
  "*em*",
  "_em_",
  "`code`",
  "**a** and *b* and `c`",
  "**unclosed",
  "`unclosed",
  "***both***",
  // The reader knows these; the regexes do not. They must still round-trip.
  "| a | b |\n| - | - |\n| 1 | 2 |",
  "~~struck~~",
  "[[Wiki Link]]",
  "[link](https://example.com)",
  "![image](a.png)",
  "```\nfenced\n```",
  "Footnote[^1]\n\n[^1]: note",
  // Shapes that break naive splitting.
  "\n",
  "\n\n\n",
  "a\n",
  "\na",
  "trailing\n\n",
  "line one\nline two",
  "  \n  \n",
  "emoji 🌱 and combining é",
  "tab\there",
  "\\# escaped heading",
];

describe("the writing surface never changes the source", () => {
  it.each(CONSTRUCTS)("round-trips %j", (value) => {
    expect(joined(segmentsForValue(value))).toBe(value);
  });

  it("round-trips every construct concatenated together", () => {
    const whole = CONSTRUCTS.join("\n");
    expect(joined(segmentsForValue(whole))).toBe(whole);
  });

  it("round-trips random text, so unwritten constructs are covered too", () => {
    // Deterministic: a seeded walk, not Math.random, so a failure reproduces.
    const alphabet = [
      "#", "*", "_", "`", ">", "-", "+", "[", "]", "(", ")", "|", "~", "\\",
      " ", "\n", "a", "1", ".", "🌱",
    ];
    let seed = 20260827;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 2000; trial += 1) {
      const length = Math.floor(next() * 40);
      let value = "";
      for (let i = 0; i < length; i += 1) {
        value += alphabet[Math.floor(next() * alphabet.length)];
      }
      expect(joined(segmentsForValue(value))).toBe(value);
    }
  });
});

describe("every segment knows which line it is on", () => {
  /**
   * `revealLine` opens the markers whose stamped line matches the caret's, so
   * a wrong line number shows the wrong line's syntax, or none at all.
   */
  it.each(CONSTRUCTS)("stamps the right line for %j", (value) => {
    let offset = 0;
    for (const segment of segmentsForValue(value)) {
      const expected = value.slice(0, offset).split("\n").length - 1;
      expect(segment.line).toBe(expected);
      offset += segment.text.length;
    }
  });
});
