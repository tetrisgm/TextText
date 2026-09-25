import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  isWorkspacePostBodyStale,
  isWorkspacePostDocumentStale,
} from "@/lib/pool/store";
import { normalizeStoredPostDocument } from "@/lib/pool/storage";
import { shouldReplaceBookmarkReadableAfterRecapture } from "@/lib/store";

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
  it("fills an empty body", () => {
    expect(shouldReplaceBookmarkReadableAfterRecapture("", "Captured words", undefined)).toBe(true);
  });

  it("preserves an annotated body even when the new capture has more images", () => {
    const current = "Captured words\n\nMy annotation";
    const next = "Captured words\n\n![image](https://example.com/image.jpg)";
    expect(shouldReplaceBookmarkReadableAfterRecapture(current, next, {
      url: "https://example.com",
      readableBodyHash: "hash-of-earlier-capture",
    })).toBe(false);
  });

  it("refreshes an unchanged captured body", () => {
    const current = "Captured words";
    expect(shouldReplaceBookmarkReadableAfterRecapture(current, "Better extraction", {
      url: "https://example.com",
      readableBodyHash: createHash("sha256").update(current).digest("hex"),
    })).toBe(true);
  });

  it("keeps legacy populated bodies rather than guessing whether they were edited", () => {
    expect(shouldReplaceBookmarkReadableAfterRecapture("Words", "New words", { url: "https://example.com" })).toBe(false);
  });
});
