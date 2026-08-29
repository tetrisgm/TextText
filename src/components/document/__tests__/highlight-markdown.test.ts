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

  it("leaves text with no marker untouched", () => {
    const nodes = run("Nothing marked at all.");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].value).toBe("Nothing marked at all.");
  });
});
