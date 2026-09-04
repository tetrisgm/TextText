import { describe, expect, it } from "vitest";
import {
  changedRecently,
  chipCensus,
  chipForPost,
  itemFolderLabel,
  itemKindLabel,
} from "@/lib/workspace/item-labels";
import type { WorkspacePoolPayload, WorkspacePoolPost } from "@/lib/pool/types";

const post = (over: Partial<WorkspacePoolPost>): WorkspacePoolPost =>
  ({
    id: over.id ?? "p",
    blogId: "b",
    type: over.type ?? "note",
    slug: "s",
    title: "T",
    status: "published",
    folderId: over.folderId ?? "notes",
    ...over,
  }) as WorkspacePoolPost;

const pool = {
  folders: [
    { id: "notes", path: "notes", name: "Notes" },
    { id: "docs", path: "documentation", name: "Documentation" },
  ],
} as unknown as WorkspacePoolPayload;

describe("item labels", () => {
  it("names a kind the same way everywhere", () => {
    expect(itemKindLabel("note")).toBe("Note");
    expect(itemKindLabel("bookmark")).toBe("Bookmark");
    expect(itemKindLabel("article")).toBe("Article");
  });

  it("names a folder by its folder name", () => {
    expect(itemFolderLabel(post({ folderId: "docs" }), pool)).toBe(
      "Documentation",
    );
  });
});

describe("chipForPost", () => {
  // The point of the chip is to mark the row that is unlike the others. A
  // chip every row carries is furniture: it costs a label on each and tells
  // you nothing about any of them.
  const majorityNotes = Array.from({ length: 9 }, (_, i) =>
    post({ id: `n${i}`, type: "note", folderId: "docs" }),
  );

  it("says nothing when the whole list is the same", () => {
    const census = chipCensus(majorityNotes, pool);
    for (const p of majorityNotes) {
      expect(chipForPost(p, pool, census)).toBeNull();
    }
  });

  it("marks the odd one out and leaves the rest alone", () => {
    const odd = post({ id: "odd", type: "article", folderId: "notes" });
    const posts = [...majorityNotes, odd];
    const census = chipCensus(posts, pool);
    expect(chipForPost(odd, pool, census)).not.toBeNull();
    expect(chipForPost(majorityNotes[0], pool, census)).toBeNull();
  });

  it("draws at most one chip, and prefers the rarer fact", () => {
    const odd = post({ id: "odd", type: "article", folderId: "notes" });
    const census = chipCensus([...majorityNotes, odd], pool);
    const chip = chipForPost(odd, pool, census);
    expect(chip).toMatchObject({ label: expect.any(String) });
    expect(["type", "folder"]).toContain(chip?.kind);
  });

  it("says nothing about a list too short to have a majority", () => {
    const two = [post({ id: "a" }), post({ id: "b", type: "article" })];
    const census = chipCensus(two, pool);
    expect(chipForPost(two[1], pool, census)).toBeNull();
  });
});

describe("changedRecently", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");
  it("marks the last day and nothing older", () => {
    expect(
      changedRecently(post({ updatedAt: "2026-09-04T06:00:00Z" }), now),
    ).toBe(true);
    expect(
      changedRecently(post({ updatedAt: "2026-09-02T06:00:00Z" }), now),
    ).toBe(false);
  });

  it("does not mark a row with no timestamp, or one from the future", () => {
    expect(changedRecently(post({}), now)).toBe(false);
    expect(
      changedRecently(post({ updatedAt: "2026-09-05T06:00:00Z" }), now),
    ).toBe(false);
  });
});
