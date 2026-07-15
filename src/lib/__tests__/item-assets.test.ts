import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Post } from "@/lib/content";
import { NO_COVER_VALUE } from "@/lib/cover";

const mocks = vi.hoisted(() => ({
  hostResolvesToPublicOnly: vi.fn(),
  isFetchableBookmarkUrl: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@/lib/bookmark-fetch", () => ({
  hostResolvesToPublicOnly: mocks.hostResolvesToPublicOnly,
  isFetchableBookmarkUrl: mocks.isFetchableBookmarkUrl,
}));
vi.mock("@vercel/blob", () => ({ put: mocks.put }));

import {
  attachItemAsset,
  importItemAssetFromUrl,
  listItemAssetReferences,
  removeItemAssetReferences,
} from "@/lib/item-assets";

const basePost: Post = {
  id: "item-1",
  type: "article",
  slug: "assets",
  title: "Assets",
  body: "Body",
  status: "draft",
  revision: 1,
};

const savedBlobToken = process.env.BLOB_READ_WRITE_TOKEN;

beforeEach(() => {
  vi.restoreAllMocks();
  for (const mock of Object.values(mocks)) mock.mockReset();
  process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
  mocks.isFetchableBookmarkUrl.mockReturnValue(true);
  mocks.hostResolvesToPublicOnly.mockResolvedValue(true);
});

afterAll(() => {
  if (savedBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = savedBlobToken;
});

describe("item asset references", () => {
  it("lists each referenced role without exposing no-cover markers", () => {
    const post: Post = {
      ...basePost,
      cover: "https://assets.example/cover.jpg",
      body: "![Diagram](https://assets.example/body.png)",
      gallery: [{
        src: "https://assets.example/gallery.webp",
        poster: "https://assets.example/poster.jpg",
      }],
      videoUrl: "https://assets.example/video.mp4",
      capture: {
        url: "https://example.com/article",
        assets: [{
          url: "https://assets.example/captured.png",
          originalUrl: "https://example.com/captured.png",
          filename: "captured.png",
          contentType: "image/png",
        }],
        screenshotUrl: "https://assets.example/screenshot.png",
      },
    };

    expect(listItemAssetReferences(post).map(({ role, url }) => [role, url]))
      .toEqual([
        ["cover", "https://assets.example/cover.jpg"],
        ["body", "https://assets.example/body.png"],
        ["gallery", "https://assets.example/gallery.webp"],
        ["gallery_poster", "https://assets.example/poster.jpg"],
        ["video", "https://assets.example/video.mp4"],
        ["capture", "https://assets.example/captured.png"],
        ["screenshot", "https://assets.example/screenshot.png"],
      ]);
    expect(listItemAssetReferences({ ...basePost, cover: NO_COVER_VALUE })).toEqual([]);
  });

  it("attaches imported assets at each supported placement", () => {
    const image = {
      url: "https://assets.example/image.png",
      contentType: "image/png",
      filename: "image.png",
      sourceUrl: "https://source.example/image.png",
      bytes: 4,
    };

    expect(attachItemAsset(basePost, image, "cover", { caption: "Cover" }))
      .toMatchObject({ cover: image.url, coverCaption: "Cover" });
    expect(attachItemAsset(basePost, image, "body_end", { altText: "Chart" }).body)
      .toBe(`Body\n\n![Chart](${image.url})`);
    expect(attachItemAsset(basePost, image, "gallery").gallery)
      .toEqual([{ src: image.url, caption: undefined }]);
  });

  it("removes exact references without changing an unrelated document", () => {
    const target = "https://assets.example/image.png";
    const similar = "https://assets.example/image.png?variant=2";
    const post: Post = {
      ...basePost,
      cover: target,
      body: `Before\n\n![Target](${target})\n\n![Keep](${similar})\n\nAfter`,
      gallery: [{ src: target }, { src: similar, poster: target }],
      videoUrl: target,
    };

    const removed = removeItemAssetReferences(post, target);
    expect(removed.changed).toBe(true);
    expect(removed.post.cover).toBeUndefined();
    expect(removed.post.videoUrl).toBeUndefined();
    expect(removed.post.body).not.toContain(`![Target](${target})`);
    expect(removed.post.body).toContain(`![Keep](${similar})`);
    expect(removed.post.gallery).toEqual([{ src: similar, poster: undefined }]);

    const untouched = { ...basePost, body: "\nBody with spacing\n" };
    expect(removeItemAssetReferences(untouched, target)).toEqual({
      changed: false,
      post: untouched,
    });
  });
});

describe("remote item asset import", () => {
  it("imports a public image into immutable document storage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      new Uint8Array([1, 2, 3, 4]),
      { headers: { "content-type": "image/png", "content-length": "4" } },
    )));
    mocks.put.mockResolvedValue({
      url: "https://store.public.blob.vercel-storage.com/final.png",
      pathname: "documents/demo/item-1/assets/final.png",
      contentType: "image/png",
    });

    await expect(importItemAssetFromUrl({
      handle: "demo",
      itemId: "item-1",
      sourceUrl: "https://images.example/R%C3%A9sum%C3%A9%20Final.PNG",
      media: "image",
    })).resolves.toEqual({
      url: "https://store.public.blob.vercel-storage.com/final.png",
      contentType: "image/png",
      filename: "final.png",
      sourceUrl: "https://images.example/R%C3%A9sum%C3%A9%20Final.PNG",
      bytes: 4,
    });
    expect(mocks.put).toHaveBeenCalledWith(
      "documents/demo/item-1/assets/resume-final.png",
      expect.any(Buffer),
      expect.objectContaining({ access: "public", addRandomSuffix: true }),
    );
  });

  it("rejects private hosts and non-image covers", async () => {
    mocks.hostResolvesToPublicOnly.mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(importItemAssetFromUrl({
      handle: "demo",
      itemId: "item-1",
      sourceUrl: "https://private.example/image.png",
    })).rejects.toThrow("public address");
    expect(fetchMock).not.toHaveBeenCalled();

    mocks.hostResolvesToPublicOnly.mockResolvedValue(true);
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1]), {
      headers: { "content-type": "video/mp4" },
    }));
    await expect(importItemAssetFromUrl({
      handle: "demo",
      itemId: "item-1",
      sourceUrl: "https://media.example/movie.mp4",
      media: "image",
    })).rejects.toThrow("cover must be an image");
  });
});
