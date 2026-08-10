// A document with no picture has no picture.
//
// Any post without a cover used to be handed a stock photograph from a pile,
// picked by hashing the post, so an article about a handheld console led with
// a photo of a road. The index showed a cover the post did not have and
// opening it found nothing of the kind. No look can correct for this, because
// the look is handed an image that was invented for it.

import { describe, expect, it } from "vitest";
import { resolveCover, resolveCoverSource } from "@/lib/cover";

const article = {
  id: "a1",
  slug: "a-post-with-no-picture",
  title: "A post with no picture",
  type: "article" as const,
  body: "Words, and not one image among them.",
  cover: undefined,
  capture: undefined,
  links: undefined,
};

describe("covers are never invented", () => {
  it("gives a post with no cover no cover", () => {
    expect(resolveCover(article)).toBe("");
    expect(resolveCoverSource(article).kind).toBe("none");
  });

  it("does not vary by post, which is how the pile used to show itself", () => {
    // The old behaviour hashed the post, so two posts got two different stock
    // photographs. Absence is the same for everyone.
    const other = { ...article, id: "b2", slug: "another", title: "Another" };
    expect(resolveCover(other)).toBe(resolveCover(article));
    expect(resolveCover(other)).toBe("");
  });

  it("still uses a cover the document actually has", () => {
    expect(resolveCover({ ...article, cover: "/covers/cover-118.jpg" })).toBe(
      "/covers/cover-118.jpg",
    );
    expect(resolveCoverSource({ ...article, cover: "/covers/cover-118.jpg" }).kind).toBe(
      "explicit",
    );
  });

  it("still uses what a bookmark capture actually found", () => {
    const bookmark = {
      ...article,
      type: "bookmark" as const,
      capture: { assets: [{ url: "https://example.com/real-image.jpg" }] },
    };
    expect(resolveCover(bookmark)).toBe("https://example.com/real-image.jpg");
  });
});
