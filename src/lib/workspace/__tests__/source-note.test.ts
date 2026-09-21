import { describe, expect, it } from "vitest";
import { sourceNoteMarkdown } from "../source-note";

describe("source notes", () => {
  it("uses an internal source reference without letting a title terminate the link", () => {
    expect(sourceNoteMarkdown("Passage", "A ]] title\ncontinued", "https://example.com", "article-slug"))
      .toBe("> Passage\n\nSource: [[article-slug|A )) title continued]]");
  });
  it("quotes every line and prevents source Markdown from becoming active content", () => {
    expect(sourceNoteMarkdown("# Heading\n[link](javascript:alert(1))\n\n<script>", "A [title]", "https://example.com/a(b)"))
      .toBe("> \\# Heading\n> \\[link\\](javascript:alert(1))\n> \n> \\<script\\>\n\nSource: [A \\[title\\]](https://example.com/a%28b%29)");
  });
  it("supports starting a note from just the source", () => {
    expect(sourceNoteMarkdown("", "Article", "https://example.com/article")).toBe("Source: [Article](https://example.com/article)");
  });
});
