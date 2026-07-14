import { describe, expect, it } from "vitest";

import {
  captureGeneration,
  completeCaptureGeneration,
  completedCaptureGeneration,
  finalizeCaptureGeneration,
  publicBookmarkCapture,
  stageCaptureGeneration,
  startCaptureGeneration,
} from "@/lib/bookmark-capture-generation";

const oldCapture = {
  url: "https://example.com/old",
  assets: [
    {
      originalUrl: "https://images.example/old.jpg",
      url: "https://write.example/captures/old.jpg",
    },
  ],
  screenshotTiles: [
    { index: 0, url: "https://write.example/captures/old-tile-0.jpg" },
    { index: 1, url: "https://write.example/captures/old-tile-1.jpg" },
  ],
};

describe("bookmark capture generations", () => {
  it("keeps the completed capture visible while a fresh generation is staged", () => {
    const storage = startCaptureGeneration(oldCapture, {
      id: "generation-2",
      url: "https://example.com/new",
      startedAt: "2026-07-14T00:00:00.000Z",
    });

    expect(storage.assets).toEqual(oldCapture.assets);
    expect(storage.screenshotTiles).toEqual(oldCapture.screenshotTiles);
    expect(captureGeneration(storage)?.capture).toEqual({
      url: "https://example.com/new",
    });
  });

  it("atomically replaces old assets and tiles only after a complete finalization", () => {
    let storage = startCaptureGeneration(oldCapture, {
      id: "generation-2",
      url: "https://example.com/new",
      startedAt: "2026-07-14T00:00:00.000Z",
    });
    const readable = [
      "# Long article",
      "![one](https://images.example/one.jpg)",
      "![two](https://images.example/two.jpg)",
    ].join("\n\n");

    const text = stageCaptureGeneration(
      storage,
      "generation-2",
      { url: "https://example.com/new", title: "Long article" },
      { startedAt: "2026-07-14T00:00:00.000Z", readableMarkdown: readable },
    );
    expect(text.ok).toBe(true);
    if (!text.ok) return;
    storage = text.storage;

    const assets = stageCaptureGeneration(
      storage,
      "generation-2",
      {
        url: "https://example.com/new",
        assets: [
          {
            originalUrl: "https://images.example/one.jpg",
            url: "https://write.example/generation-2/one.jpg",
          },
          {
            originalUrl: "https://images.example/two.jpg",
            url: "https://write.example/generation-2/two.jpg",
          },
        ],
      },
      { startedAt: "2026-07-14T00:00:00.000Z" },
    );
    expect(assets.ok).toBe(true);
    if (!assets.ok) return;
    storage = assets.storage;

    for (const index of [0, 1, 2]) {
      const tile = stageCaptureGeneration(
        storage,
        "generation-2",
        {
          url: "https://example.com/new",
          screenshotTiles: [
            { index, url: `https://write.example/generation-2/tile-${index}.jpg` },
          ],
        },
        { startedAt: "2026-07-14T00:00:00.000Z", screenshotCount: 3 },
      );
      expect(tile.ok).toBe(true);
      if (!tile.ok) return;
      storage = tile.storage;
    }

    const finalized = finalizeCaptureGeneration(storage, "generation-2");
    expect(finalized).toMatchObject({ ok: true });
    if (!finalized.ok) return;
    expect(finalized.capture.assets?.map((asset) => asset.originalUrl)).toEqual([
      "https://images.example/one.jpg",
      "https://images.example/two.jpg",
    ]);
    expect(finalized.capture.screenshotTiles?.map((tile) => tile.index)).toEqual([
      0, 1, 2,
    ]);
    expect(finalized.capture.assets).not.toContainEqual(oldCapture.assets[0]);
    expect(finalized.capture.screenshotTiles).not.toContainEqual(
      oldCapture.screenshotTiles[0],
    );

    const completedStorage = completeCaptureGeneration(
      finalized.capture,
      "generation-2",
    );
    expect(completedCaptureGeneration(completedStorage)).toBe("generation-2");
    expect(publicBookmarkCapture(completedStorage)).toEqual(finalized.capture);
    expect(
      stageCaptureGeneration(
        completedStorage,
        "generation-2",
        { url: "https://example.com/new", screenshotTiles: [] },
        { startedAt: "2026-07-14T00:01:00.000Z" },
      ),
    ).toMatchObject({ ok: false, reason: "stale" });
  });

  it("rejects incomplete tiles, missing readable assets, and late stale uploads", () => {
    let storage = startCaptureGeneration(oldCapture, {
      id: "generation-2",
      url: "https://example.com/new",
      startedAt: "2026-07-14T00:00:00.000Z",
    });
    const partial = stageCaptureGeneration(
      storage,
      "generation-2",
      {
        url: "https://example.com/new",
        screenshotTiles: [{ index: 0, url: "https://write.example/new-0.jpg" }],
      },
      {
        startedAt: "2026-07-14T00:00:00.000Z",
        readableMarkdown: "![missing](https://images.example/missing.jpg)",
        screenshotCount: 2,
      },
    );
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    storage = partial.storage;

    expect(finalizeCaptureGeneration(storage, "generation-2")).toMatchObject({
      ok: false,
      reason: "incomplete",
    });
    expect(
      stageCaptureGeneration(
        storage,
        "generation-1",
        { url: "https://example.com/stale" },
        { startedAt: "2026-07-13T00:00:00.000Z" },
      ),
    ).toMatchObject({ ok: false, reason: "stale" });
  });

  it("finalizes a long lazy article only with complete image and tile coverage", () => {
    const imageUrls = Array.from(
      { length: 60 },
      (_, index) => `https://images.example/long-article-${index + 1}.jpg`,
    );
    let storage = startCaptureGeneration(oldCapture, {
      id: "long-article-generation",
      url: "https://example.com/long-article",
      startedAt: "2026-07-14T00:00:00.000Z",
    });
    const readableMarkdown = imageUrls
      .map((url, index) => `![Article image ${index + 1}](${url})`)
      .join("\n\n");
    const readable = stageCaptureGeneration(
      storage,
      "long-article-generation",
      { url: "https://example.com/long-article", title: "Long article" },
      {
        startedAt: "2026-07-14T00:00:00.000Z",
        readableMarkdown,
      },
    );
    expect(readable.ok).toBe(true);
    if (!readable.ok) return;
    storage = readable.storage;

    const assets = stageCaptureGeneration(
      storage,
      "long-article-generation",
      {
        url: "https://example.com/long-article",
        assets: imageUrls.map((originalUrl, index) => ({
          originalUrl,
          url: `https://write.example/long-article-generation/image-${index + 1}.jpg`,
        })),
      },
      { startedAt: "2026-07-14T00:00:00.000Z" },
    );
    expect(assets.ok).toBe(true);
    if (!assets.ok) return;
    storage = assets.storage;

    for (let index = 0; index < 22; index += 1) {
      const tile = stageCaptureGeneration(
        storage,
        "long-article-generation",
        {
          url: "https://example.com/long-article",
          screenshotTiles: [
            {
              index,
              url: `https://write.example/long-article-generation/tile-${index}.jpg`,
            },
          ],
        },
        {
          startedAt: "2026-07-14T00:00:00.000Z",
          screenshotCount: 22,
        },
      );
      expect(tile.ok).toBe(true);
      if (!tile.ok) return;
      storage = tile.storage;
    }

    const finalized = finalizeCaptureGeneration(
      storage,
      "long-article-generation",
    );
    expect(finalized).toMatchObject({ ok: true });
    if (!finalized.ok) return;
    expect(finalized.capture.assets).toHaveLength(60);
    expect(finalized.capture.screenshotTiles).toHaveLength(22);
    expect(finalized.capture.assets).not.toContainEqual(oldCapture.assets[0]);
    expect(finalized.capture.screenshotTiles).not.toContainEqual(
      oldCapture.screenshotTiles[0],
    );
  });
});
