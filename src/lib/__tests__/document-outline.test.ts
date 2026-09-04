import { describe, expect, it } from "vitest";
import { documentOutline } from "@/lib/document-outline";

describe("documentOutline", () => {
  it("reads headings with their level and line", () => {
    const body = ["# Title", "", "text", "## Section", "### Deeper"].join("\n");
    expect(documentOutline(body)).toEqual([
      { line: 0, level: 1, text: "Title" },
      { line: 3, level: 2, text: "Section" },
      { line: 4, level: 3, text: "Deeper" },
    ]);
  });

  it("ignores hashes inside fenced code", () => {
    const body = [
      "# Real",
      "```bash",
      "# not a heading",
      "```",
      "## Also real",
      "~~~",
      "### hidden",
      "~~~",
    ].join("\n");
    expect(documentOutline(body).map((e) => e.text)).toEqual([
      "Real",
      "Also real",
    ]);
  });

  it("strips closing hashes and skips empty headings", () => {
    expect(documentOutline("## Middle ##\n#\n#   ").map((e) => e.text)).toEqual([
      "Middle",
    ]);
  });

  it("does not treat a hash without a space as a heading", () => {
    expect(documentOutline("#nope\n#1 tag")).toEqual([]);
  });
});
