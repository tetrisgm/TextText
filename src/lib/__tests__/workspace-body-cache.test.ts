import { describe, expect, it } from "vitest";
import { isWorkspacePostBodyStale } from "@/lib/pool/store";
import { shouldRefreshBookmarkReadable } from "@/lib/store";

describe("workspace body freshness", () => {
  it("invalidates a cached body when capture metadata is newer", () => {
    expect(
      isWorkspacePostBodyStale(
        "2026-07-09T12:00:01.000Z",
        "2026-07-09T12:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("keeps a body cached when it matches the post", () => {
    expect(
      isWorkspacePostBodyStale(
        "2026-07-09T12:00:00.000Z",
        "2026-07-09T12:00:00.000Z",
      ),
    ).toBe(false);
  });
});

describe("bookmark recapture replacement", () => {
  const assets = Array.from({ length: 3 }, (_, index) => ({
    originalUrl: `https://example.com/image-${index}.jpg`,
    url: `https://assets.example.com/image-${index}.jpg`,
  }));

  it("replaces a poorer extraction with a richer image capture", () => {
    const current = `Words\n\n![one](${assets[0].url})`;
    const next = assets
      .map((asset, index) => `![image ${index}](${asset.url})`)
      .join("\n\n");
    expect(shouldRefreshBookmarkReadable(current, next, assets)).toBe(true);
  });

  it("preserves an annotated body when the recapture is not richer", () => {
    const current = `My annotation\n\n![one](${assets[0].url})`;
    const next = `Captured words\n\n![one](${assets[0].url})`;
    expect(shouldRefreshBookmarkReadable(current, next, assets)).toBe(false);
  });
});
