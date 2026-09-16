import { describe, expect, it } from "vitest";
import { extractArticleHtml, extractArticleMarkdown } from "../extract.server";

const para = (n: number) => `<p>Paragraph ${n} carries enough words to count as article prose for the extractor to keep it here.</p>`;

describe("full-content extraction", () => {
  it("prefers a marked article and drops chrome regions", () => {
    const html = `<html><head><script>x()</script><style>p{}</style></head><body>
      <nav><p>Home News Sport Weather Menu items with plenty of words to fool a counter</p></nav>
      <header><p>Site header with a long tagline that is not the article body at all really</p></header>
      <article><h1>Title</h1>${para(1)}${para(2)}<aside><p>Related links that should go away entirely from the article</p></aside>${para(3)}</article>
      <footer><p>Footer text about cookies and terms that is definitely not the article content</p></footer>
    </body></html>`;
    const markdown = extractArticleMarkdown(html)!;
    expect(markdown).toContain("# Title");
    expect(markdown).toContain("Paragraph 1");
    expect(markdown).toContain("Paragraph 3");
    expect(markdown).not.toContain("Related links");
    expect(markdown).not.toContain("Footer text");
    expect(markdown).not.toContain("Home News");
  });

  it("falls back to the run of substantial paragraphs when nothing is marked", () => {
    const html = `<div class="wrap"><div class="ad"><p>Buy now</p></div>${para(1)}${para(2)}${para(3)}<p>Short.</p></div>`;
    const article = extractArticleHtml(html)!;
    expect(article).toContain("Paragraph 1");
    expect(article).not.toContain("Buy now");
    expect(article).not.toContain("Short.");
  });

  it("returns null for pages that do not read as an article", () => {
    expect(extractArticleMarkdown("<html><body><p>Hi</p><ul><li>a</li></ul></body></html>")).toBeNull();
  });
});
