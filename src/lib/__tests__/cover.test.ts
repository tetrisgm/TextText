import { describe, expect, it } from "vitest";
import { resolveCoverSource } from "@/lib/cover";

describe("resolveCoverSource", () => {
  it("prefers a saved bookmark asset over the full-page screenshot", () => {
    const cover = resolveCoverSource({
      body: "![picture](https://remote.example/metroid.jpg)",
      capture: {
        url: "https://remote.example",
        assets: [
          {
            originalUrl: "https://remote.example/metroid.jpg",
            url: "https://blob.vercel-storage.com/captures/metroid-asset.webp",
          },
        ],
        screenshotUrl: "https://blob.vercel-storage.com/captures/metroid.webp",
      },
      cover: "",
      id: "bookmark-1",
      links: [{ href: "https://remote.example", label: "Metroid" }],
      slug: "metroid",
      title: "Metroid",
      type: "bookmark",
    });

    expect(cover).toEqual({
      kind: "bookmark-body-image",
      src: "https://blob.vercel-storage.com/captures/metroid-asset.webp",
    });
  });

  it("uses a saved bookmark screenshot when no captured article image exists", () => {
    const cover = resolveCoverSource({
      body: "![picture](https://remote.example/metroid.jpg)",
      capture: {
        url: "https://remote.example",
        screenshotUrl: "https://blob.vercel-storage.com/captures/metroid.webp",
      },
      cover: "",
      id: "bookmark-1b",
      links: [{ href: "https://remote.example", label: "Metroid" }],
      slug: "metroid",
      title: "Metroid",
      type: "bookmark",
    });

    expect(cover).toEqual({
      kind: "bookmark-screenshot",
      src: "https://blob.vercel-storage.com/captures/metroid.webp",
    });
  });

  it("does not use remote readable images as a bookmark cover", () => {
    const cover = resolveCoverSource({
      body: "![picture](https://remote.example/metroid.jpg)",
      capture: {
        url: "https://remote.example",
      },
      cover: "",
      id: "bookmark-2",
      links: [{ href: "https://remote.example", label: "Metroid" }],
      slug: "metroid",
      title: "Metroid",
      type: "bookmark",
    });

    expect(cover).toEqual({
      kind: "bookmark-favicon",
      src: "https://remote.example/favicon.ico",
    });
  });
});
