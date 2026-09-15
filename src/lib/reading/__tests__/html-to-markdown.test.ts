import { describe, expect, it } from "vitest";
import { decodeHtmlEntities, htmlToMarkdown, htmlToText } from "../html-to-markdown";

describe("htmlToMarkdown (ING-04 safe conversion)", () => {
  it("keeps structure: headings, paragraphs, lists, quotes, code, links, images", () => {
    const { markdown, imageCount } = htmlToMarkdown(
      `<h1>Title</h1><p>Para <strong>bold</strong> and <em>em</em>.</p>
       <ul><li>a</li><li>b<ul><li>nested</li></ul></li></ul>
       <ol><li>one</li><li>two</li></ol>
       <blockquote><p>quoted</p></blockquote>
       <pre><code>const x = 1;\nconst y = 2;</code></pre>
       <p>See <a href="https://ex.example/p?x=1">the page</a> <img src="https://ex.example/i.png" alt="pic"></p>`,
    );
    expect(markdown).toContain("## Title");
    expect(markdown).toContain("Para **bold** and _em_.");
    expect(markdown).toContain("- a\n- b\n  - nested");
    expect(markdown).toContain("1. one\n2. two");
    expect(markdown).toContain("> quoted");
    expect(markdown).toContain("```\nconst x = 1;\nconst y = 2;\n```");
    expect(markdown).toContain("[the page](https://ex.example/p?x=1)");
    expect(markdown).toContain("![pic](https://ex.example/i.png)");
    expect(imageCount).toBe(1);
  });

  it("drops scripts, styles, frames, forms and event handlers entirely", () => {
    const { markdown } = htmlToMarkdown(
      `<p onclick="x()">ok</p><script>bad()</script><style>p{}</style><iframe src="https://e.example"></iframe><form><input value="v"></form><noscript>n</noscript>`,
    );
    expect(markdown).toBe("ok");
  });

  it("never emits a raw tag, even for unknown or malformed markup", () => {
    const { markdown } = htmlToMarkdown(`<custom-tag attr="x">inside</custom-tag><p>after <unclosed`);
    expect(markdown).not.toMatch(/<[a-z]/i);
    expect(markdown).toContain("inside");
    expect(markdown).toContain("after");
  });

  it("escapes text that would otherwise become Markdown structure", () => {
    const { markdown } = htmlToMarkdown(`<p># not a heading and *not emphasis*</p>`);
    expect(markdown).toBe("\\# not a heading and \\*not emphasis\\*");
  });

  it("decodes entities, including numeric, and refuses control characters", () => {
    expect(decodeHtmlEntities("a &amp; b &#x27;c&#39; &lt;d&gt; &#1; &ndash; &unknown;")).toBe(
      "a & b 'c' <d>  – &unknown;",
    );
  });

  it("produces plain text without markup", () => {
    expect(htmlToText(`<p>Hi <b>there</b> <a href="https://x.example">link</a></p>`)).toBe(
      "Hi there link",
    );
  });
});
