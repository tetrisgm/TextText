import { describe, expect, it } from "vitest";
import { absoluteHttps, pageMetaFromHtml } from "../page-image";
import { imageFromEntry, imageFromMarkdown } from "../ingest.server";

/**
 * Where an item's picture comes from, in the order it is looked for: what the
 * feed attached, what the feed's own body showed, and what the page declares
 * for its social card.
 */

describe("the picture a page declares", () => {
  it("prefers og:image, and resolves it against the page", () => {
    const html = `<head><meta property="og:image" content="/card.png"><meta name="twitter:image" content="https://cdn.example.com/t.jpg"></head>`;
    expect(pageMetaFromHtml(html, "https://example.com/a/b").image).toBe("https://example.com/card.png");
  });

  it("takes twitter:image when there is no og:image", () => {
    const html = `<meta name="twitter:image" content="https://cdn.example.com/t.jpg">`;
    expect(pageMetaFromHtml(html, "https://example.com/").image).toBe("https://cdn.example.com/t.jpg");
  });

  it("falls back to a large icon rather than nothing", () => {
    const html = `<link rel="apple-touch-icon" href="https://example.com/icon.png">`;
    expect(pageMetaFromHtml(html, "https://example.com/").image).toBe("https://example.com/icon.png");
  });

  it("reads the publication's name when the page gives one", () => {
    const html = `<meta property="og:site_name" content="Ars Technica">`;
    expect(pageMetaFromHtml(html, "https://example.com/").siteName).toBe("Ars Technica");
  });

  it("refuses anything that is not https, because the page hotlinks it", () => {
    const html = `<meta property="og:image" content="http://example.com/card.png">`;
    expect(pageMetaFromHtml(html, "http://example.com/").image).toBeNull();
    expect(absoluteHttps("//cdn.example.com/x.png", "https://example.com/")).toBe("https://cdn.example.com/x.png");
  });

  it("survives a page with nothing to say", () => {
    expect(pageMetaFromHtml("<html><body>hello</body></html>", "https://example.com/")).toEqual({ image: null, siteName: null });
  });

  it("unescapes an entity in the URL, which query strings are full of", () => {
    const html = `<meta property="og:image" content="https://example.com/c.png?w=1&amp;h=2">`;
    expect(pageMetaFromHtml(html, "https://example.com/").image).toBe("https://example.com/c.png?w=1&h=2");
  });
});

describe("the picture a feed supplies", () => {
  it("takes an image attachment first", () => {
    expect(
      imageFromEntry({ attachments: [{ url: "https://example.com/a.jpg", mimeType: "image/jpeg" }], bodyMarkdown: "![x](https://example.com/b.jpg)" }),
    ).toBe("https://example.com/a.jpg");
  });

  it("ignores an attachment that is not a picture", () => {
    expect(imageFromEntry({ attachments: [{ url: "https://example.com/a.mp3", mimeType: "audio/mpeg" }] })).toBeNull();
  });

  it("falls back to the first picture in the body a full feed sent", () => {
    expect(imageFromEntry({ bodyMarkdown: "Words.\n\n![lead](https://example.com/lead.jpg)\n" })).toBe("https://example.com/lead.jpg");
  });

  it("skips the tracking pixels feeds are full of", () => {
    expect(imageFromMarkdown("![](https://example.com/pixel.gif) ![real](https://example.com/photo.jpg)")).toBe("https://example.com/photo.jpg");
    expect(imageFromMarkdown("![](https://stats.example.com/1x1.png)")).toBeNull();
  });

  it("takes nothing from an http image", () => {
    expect(imageFromMarkdown("![x](http://example.com/a.jpg)")).toBeNull();
  });
});
