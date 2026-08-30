import { describe, expect, it } from "vitest";
import {
  isWorkspacePostBodyStale,
  isWorkspacePostDocumentStale,
} from "@/lib/pool/store";
import { normalizeStoredPostDocument } from "@/lib/pool/storage";
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

  it("prefers monotonic revisions over timestamps", () => {
    expect(
      isWorkspacePostDocumentStale(
        9,
        "2026-07-09T12:00:00.000Z",
        8,
        "2026-07-09T12:01:00.000Z",
      ),
    ).toBe(true);
    expect(
      isWorkspacePostDocumentStale(
        8,
        "2026-07-09T12:01:00.000Z",
        9,
        "2026-07-09T12:00:00.000Z",
      ),
    ).toBe(false);
  });

  it("never turns a legacy body into a document without a canonical fallback", () => {
    const stored = {
      blogId: "blog-1",
      postId: "post-1",
      body: "Legacy body",
      fetchedAt: "2026-07-09T12:00:00.000Z",
    };
    expect(
      normalizeStoredPostDocument(stored, {
        blogId: "blog-1",
        postId: "post-1",
      }),
    ).toBeNull();

    const migrated = normalizeStoredPostDocument(stored, {
      blogId: "blog-1",
      postId: "post-1",
      fallbackDocument: {
        schemaVersion: 1,
        content: {
          title: "Kept title",
          body: "Server body",
          fields: { mood: "good" },
          tags: ["kept"],
          assets: [],
        },
        presentation: {
          template: { id: "texttext.note", version: 1 },
          theme: { accent: "#123456" },
        },
      },
    });
    expect(migrated?.document).toMatchObject({
      content: {
        title: "Kept title",
        body: "Legacy body",
        fields: { mood: "good" },
        tags: ["kept"],
      },
      presentation: {
        template: { id: "texttext.note", version: 1 },
        theme: { accent: "#123456" },
      },
    });
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
