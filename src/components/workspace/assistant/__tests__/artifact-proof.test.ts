import { describe, expect, it } from "vitest";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import {
  itemArtifactProof,
  mergeArtifactProofs,
  workspaceToolArtifactProofs,
} from "../artifact-proof";

const pool = {
  version: 1,
  blogId: "blog-1",
  blog: { handle: "writer", username: "writer" },
  folders: [
    { id: "notes", path: "notes", name: "Notes", mode: "notes" },
    { id: "blog", path: "blog", name: "Blog", mode: "blog" },
  ],
  counts: {},
  posts: [
    {
      id: "note-1",
      blogId: "blog-1",
      folderId: "notes",
      type: "note",
      slug: "launch-notes",
      title: "Launch notes",
      status: "draft",
    },
    {
      id: "post-1",
      blogId: "blog-1",
      folderId: "blog",
      type: "article",
      slug: "launch-plan",
      title: "Launch plan",
      status: "draft",
    },
  ],
  trashedPosts: [
    {
      id: "trash-1",
      blogId: "blog-1",
      folderId: "notes",
      type: "note",
      slug: "old-note",
      title: "Old note",
      status: "draft",
    },
  ],
  templates: [],
  fetchedAt: "2026-08-20T00:00:00.000Z",
} as unknown as WorkspacePoolPayload;

describe("assistant artifact proof", () => {
  it("uses the exact stored item title, folder, and route", () => {
    expect(
      itemArtifactProof({
        id: "note-1",
        operation: "Read",
        pool,
      }),
    ).toEqual({
      operation: "Read",
      itemId: "note-1",
      title: "Launch notes",
      folderPath: "notes",
      href: "/@writer/notes/launch-notes",
    });
  });

  it("derives source proof from validated search results", () => {
    expect(
      workspaceToolArtifactProofs({
        tool: "search",
        args: { query: "launch" },
        output: {
          results: [
            { id: "note-1", title: "Launch notes" },
            { id: "post-1", title: "Launch plan" },
          ],
        },
        pool,
      }),
    ).toMatchObject([
      { operation: "Found", itemId: "note-1", folderPath: "notes" },
      { operation: "Found", itemId: "post-1", folderPath: "blog" },
    ]);
  });

  it("uses the authoritative capture receipt before the pool refresh lands", () => {
    expect(
      workspaceToolArtifactProofs({
        tool: "create_item",
        args: { capture: "A note saved by the assistant" },
        output: {
          item: {
            id: "note-new",
            slug: "a-note-saved-by-the-assistant",
            title: "A note saved by the assistant",
          },
          receipt: {
            item_id: "note-new",
            kind: "note",
            saved_to: "notes",
            title: "A note saved by the assistant",
          },
        },
        pool,
      }),
    ).toEqual([
      {
        operation: "Created",
        itemId: "note-new",
        title: "A note saved by the assistant",
        folderPath: "notes",
        href: "/@writer/notes/a-note-saved-by-the-assistant",
      },
    ]);
  });

  it("does not turn unsupported model or tool output into proof", () => {
    expect(
      workspaceToolArtifactProofs({
        tool: "get_workspace",
        args: {},
        output: { message: "I created a note" },
        pool,
      }),
    ).toEqual([]);
  });

  it("proves item-scoped reads and exact Trash results", () => {
    expect(
      workspaceToolArtifactProofs({
        tool: "list_access",
        args: { id: "note-1" },
        output: { access: [] },
        pool,
      }),
    ).toMatchObject([
      { operation: "Read", itemId: "note-1", folderPath: "notes" },
    ]);
    expect(
      workspaceToolArtifactProofs({
        tool: "list_trash",
        args: {},
        output: { items: [{ id: "trash-1", title: "Old note" }] },
        pool,
      }),
    ).toEqual([
      {
        operation: "Found",
        itemId: "trash-1",
        title: "Old note",
        folderPath: "notes",
      },
    ]);
  });

  it("lets a write receipt supersede a read receipt for the same item", () => {
    const read = itemArtifactProof({
      id: "note-1",
      operation: "Read",
      pool,
    });
    const updated = itemArtifactProof({
      id: "note-1",
      operation: "Updated",
      pool,
    });
    expect(
      mergeArtifactProofs(read ? [read] : [], updated ? [updated] : []),
    ).toEqual([
      expect.objectContaining({ operation: "Updated", itemId: "note-1" }),
    ]);
  });
});
