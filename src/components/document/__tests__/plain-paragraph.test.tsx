import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { plainParagraph } from "../plain-paragraph";

describe("syntax-free Markdown paragraph", () => {
  it.each(["Simple prose.", "First line, more words.\nSecond line.", "\nA paragraph.\n", "日本語の文章。".replace("。", "."), "Café 123.\nMore words.", "Sentence 1. Still prose."])("matches the real GFM renderer for %j", value => {
    const plain = plainParagraph(value);
    expect(plain).not.toBeNull();
    expect(renderToStaticMarkup(<p>{plain}</p>)).toBe(renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>));
  });
  it.each(["", " ", "One\n\nTwo", "    code", "One\n  continued", "1. list", "One\n2. list", "www.example.com", "https://example.com", "a@example.com", "**bold**", "==highlight==", "[[link]]", "# heading", "- list", "A  \nB", "A\tB", "<img>", "A &amp; B", "a_b", "A\r\nB", " leading", "trailing ", "A \nB", "| A | B |\n| --- | --- |", "a\\b", "123. list", "   indented"])("falls back for ambiguous Markdown %j", value => {
    // Dotted www names need the GFM autolink pipeline despite plain punctuation.
    expect(plainParagraph(value)).toBeNull();
  });
  it("retains every line in the large-note fixture", () => {
    const line = "One careful paragraph about a file library, its notes, reading, and images.\n";
    const body = line.repeat(7300);
    expect(plainParagraph(body)).toBe(body.slice(0, -1));
  });
});
