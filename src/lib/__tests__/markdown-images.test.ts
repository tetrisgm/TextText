import { describe, expect, it } from "vitest";
import {
  isRemoteImageUrl,
  localizeRemoteMarkdownImages,
  remoteMarkdownImageUrls,
  stripRemoteMarkdownImages,
} from "@/lib/markdown-images";

describe("isRemoteImageUrl", () => {
  it("matches only http and https URLs", () => {
    expect(isRemoteImageUrl("https://example.com/image.jpg")).toBe(true);
    expect(isRemoteImageUrl("http://example.com/image.jpg")).toBe(true);
    expect(isRemoteImageUrl("/assets/image.jpg")).toBe(false);
    expect(isRemoteImageUrl("./post.assets/image.jpg")).toBe(false);
    expect(isRemoteImageUrl("data:image/png;base64,abc")).toBe(false);
  });
});

describe("remoteMarkdownImageUrls", () => {
  it("returns unique remote image URLs in Markdown order", () => {
    const markdown = [
      "[![linked](https://assets.example/linked.webp)](https://example.com)",
      '![titled](<http://assets.example/titled.png> "Title")',
      "![duplicate](https://assets.example/linked.webp)",
      "![local](./assets/local.png)",
      "[ordinary link](https://assets.example/not-an-image.jpg)",
    ].join("\n\n");

    expect(remoteMarkdownImageUrls(markdown)).toEqual([
      "https://assets.example/linked.webp",
      "http://assets.example/titled.png",
    ]);
  });

  it("handles missing and empty Markdown", () => {
    expect(remoteMarkdownImageUrls(undefined)).toEqual([]);
    expect(remoteMarkdownImageUrls("")).toEqual([]);
  });
});

describe("stripRemoteMarkdownImages", () => {
  it("removes remote markdown images and linked remote markdown images", () => {
    const markdown = [
      "Intro",
      "",
      "![picture](https://example.com/picture.jpg)",
      "",
      "[![cover](https://example.com/cover.webp)](https://example.com/story)",
      "",
      "Outro",
    ].join("\n");

    expect(stripRemoteMarkdownImages(markdown)).toBe("Intro\n\nOutro");
  });

  it("keeps local markdown images for future materialized assets", () => {
    const markdown = [
      "Intro",
      "",
      "![saved](./post.assets/saved.webp)",
      "",
      "Outro",
    ].join("\n");

    expect(stripRemoteMarkdownImages(markdown)).toBe(markdown);
  });

  it("can preserve Texttext-hosted remote images after localization", () => {
    const localUrl =
      "https://blob.vercel-storage.com/captures/page/assets/picture.webp";
    const replacements = new Map([
      ["https://remote.example/picture.jpg", localUrl],
    ]);
    const localized = localizeRemoteMarkdownImages(
      "![picture](https://remote.example/picture.jpg)\n\n![other](https://remote.example/other.jpg)",
      replacements,
    );

    expect(
      stripRemoteMarkdownImages(localized, {
        preserveUrls: new Set(replacements.values()),
      }),
    ).toBe(`![picture](${localUrl})`);
  });
});
