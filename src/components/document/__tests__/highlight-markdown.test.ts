import { describe, expect, it } from "vitest";

import { remarkHighlight } from "@/components/document/HighlightMarkdown";

type Node = { type: string; value?: string; children?: Node[]; data?: Record<string, unknown> };

/** A paragraph of one text node, the shape remark hands the plugin. */
function paragraph(text: string): Node {
  return { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: text }] }] };
}

function run(text: string): Node[] {
  const tree = paragraph(text);
  remarkHighlight()(tree);
  return tree.children![0].children!;
}

function marks(text: string): string[] {
  return run(text)
    .filter((node) => node.data?.hName === "mark")
    .map((node) => node.children?.[0]?.value ?? "");
}

/**
 * "Add some highlights on the important parts" is one of the things this
 * product is for, and there was no way to do it: the reader renders GFM, which
 * has no highlight, so the assistant bolded things instead, which means
 * something else.
 */
describe("==highlight==", () => {
  it("marks the highlighted span and nothing else", () => {
    const nodes = run("The alert fired and ==nobody believed it== that day.");
    expect(marks("The alert fired and ==nobody believed it== that day.")).toEqual([
      "nobody believed it",
    ]);
    expect(nodes.map((node) => node.value ?? "").join("")).toBe(
      "The alert fired and  that day.",
    );
  });

  it("keeps two highlights separate rather than swallowing the middle", () => {
    expect(marks("==first== and ==second==")).toEqual(["first", "second"]);
  });

  it("leaves an unclosed marker as ordinary text", () => {
    // Otherwise a stray == would highlight the rest of someone's note.
    expect(marks("a == b")).toEqual([]);
    expect(marks("== unclosed to the end")).toEqual([]);
  });

  it("does not run across a line", () => {
    expect(marks("open ==here\nand close== there")).toEqual([]);
  });

  it("leaves comparisons in code alone", () => {
    const tree: Node = {
      type: "root",
      children: [{ type: "inlineCode", value: "a ==b", children: [] }],
    };
    remarkHighlight()(tree);
    expect(tree.children![0].value).toBe("a ==b");
  });

  it("does not treat an empty marker as a highlight", () => {
    expect(marks("==== nothing here")).toEqual([]);
    expect(marks("== ==")).toEqual([]);
  });

  it.each([
    "a === b",
    "a === b === c",
    "if (x == y) then",
    "x == y and y == z",
    "====",
    "== ==",
    "a == b == c",
    // Prose about code. These marked "mc" and "arr[j]" until the markers had
    // to flank the way emphasis does.
    "The formula is E==mc== squared?",
    "arr[i]==arr[j]==arr[k]",
    "x==y",
    "sep: ==========",
    "5 == 5 is true, and 6 == 6 is too",
    "a ==",
    "== b",
  ])("leaves %s alone", (text) => {
    expect(marks(text)).toEqual([]);
  });

  it.each([
    ["==one==", ["one"]],
    ["a ==key point== here", ["key point"]],
    ["==first== and ==second==", ["first", "second"]],
    ["==with punctuation, yes==", ["with punctuation, yes"]],
    ["(==parenthesised==)", ["parenthesised"]],
    ["He said ==this matters==.", ["this matters"]],
    // Real punctuation, not just ASCII. An ASCII-only flanking set refused a
    // phrase wrapped in curly quotes or set off with an em dash, which is
    // exactly where a person emphasises something.
    ["\u201c==important==\u201d", ["important"]],
    ["\u2014==important==\u2014", ["important"]],
    ["It was\u2014==this==\u2014all along", ["this"]],
  ])("marks %s", (text, expected) => {
    expect(marks(text)).toEqual(expected);
  });

  it("leaves text with no marker untouched", () => {
    const nodes = run("Nothing marked at all.");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].value).toBe("Nothing marked at all.");
  });
});
