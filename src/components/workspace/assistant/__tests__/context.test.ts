import { describe, expect, it } from "vitest";
import {
  appendAssistantSelectionContext,
  assistantContextChipWithSelection,
  resolveWorkspaceAssistantContext,
} from "@/components/workspace/assistant/context";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";

function post(patch: Partial<WorkspacePoolPost> = {}): WorkspacePoolPost {
  return {
    id: "post-1",
    blogId: "blog-1",
    folderId: "notes",
    type: "note",
    slug: "selected-note",
    title: "Selected note",
    status: "draft",
    pinned: false,
    createdAt: "2026-07-14T12:00:00.000Z",
    updatedAt: "2026-07-14T12:00:00.000Z",
    ...patch,
  };
}

function pool(posts: WorkspacePoolPost[] = [post()]): WorkspacePoolPayload {
  return {
    version: 1,
    blogId: "blog-1",
    fetchedAt: "2026-07-14T12:00:00.000Z",
    blog: {
      handle: "local",
      name: "Writer's desk",
      author: "Writer",
      tagline: "",
      homeLayout: "grid",
    },
    folders: [
      { id: "blog", name: "Blog", path: "blog", mode: "blog", position: 0 },
      {
        id: "notes",
        name: "Notes",
        path: "notes",
        mode: "notes",
        position: 1,
      },
    ],
    posts,
    counts: {},
    templates: [],
  };
}

describe("workspace assistant context", () => {
  it("uses the selected folder at the workspace root", () => {
    expect(
      resolveWorkspaceAssistantContext({
        homePath: "/t/local",
        pool: pool(),
        selectedFolderPath: "notes",
        selectedPostId: null,
        view: { level: "root" },
      }),
    ).toEqual({
      chip: { kind: "folder", label: "Notes", detail: "Folder" },
      contextKey: "place:/t/local?folder=notes",
      view: { level: "section", folderPath: "notes" },
    });
  });

  it("uses the selected item while its folder remains open", () => {
    expect(
      resolveWorkspaceAssistantContext({
        homePath: "/t/local",
        pool: pool(),
        selectedFolderPath: "notes",
        selectedPostId: "post-1",
        view: { level: "section", folderPath: "notes" },
      }),
    ).toEqual({
      chip: {
        kind: "item",
        label: "Selected note",
        detail: "Selected item",
      },
      contextKey: "item:post-1",
      view: { level: "post", folderPath: "notes", postId: "post-1" },
    });
  });

  it("keeps an open editor item authoritative and stable across renames", () => {
    const result = resolveWorkspaceAssistantContext({
      homePath: "/t/local",
      pool: pool([post({ title: "Renamed locally" })]),
      selectedFolderPath: "blog",
      selectedPostId: null,
      view: { level: "edit", folderPath: "notes", postId: "post-1" },
    });

    expect(result.contextKey).toBe("item:post-1");
    expect(result.chip).toEqual({
      kind: "item",
      label: "Renamed locally",
      detail: "Editing",
    });
    expect(result.view.level).toBe("edit");
  });

  it("falls back to the current place when there is no selectable item", () => {
    const emptyFolder = resolveWorkspaceAssistantContext({
      homePath: "/t/local",
      pool: pool([]),
      selectedFolderPath: null,
      selectedPostId: null,
      view: { level: "section", folderPath: "notes" },
    });
    const trash = resolveWorkspaceAssistantContext({
      homePath: "/t/local",
      pool: pool([]),
      selectedFolderPath: null,
      selectedPostId: null,
      view: { level: "trash", folderPath: "trash" },
    });

    expect(emptyFolder.chip.label).toBe("Notes");
    expect(emptyFolder.view).toEqual({
      level: "section",
      folderPath: "notes",
    });
    expect(trash).toMatchObject({
      chip: { label: "Trash" },
      contextKey: "place:/t/local?folder=trash",
      view: { level: "trash", folderPath: "trash" },
    });
  });

  it("describes the live field and source range to the native assistant", () => {
    const selection = {
      field: "excerpt" as const,
      start: 4,
      end: 17,
      text: "selected text",
    };
    const context = appendAssistantSelectionContext("Item is open.", {
      title: "Draft",
      excerpt: "The selected text is here.",
      body: "Body",
      selection,
    });

    expect(context).toContain(
      "selected excerpt text at source range [4, 17)",
    );
    expect(context).toContain('Title: "Draft"');
    expect(context).toContain('Body: "Body"');
    expect(context).toContain('Selected text: "selected text"');
    expect(
      assistantContextChipWithSelection(
        { kind: "item", label: "Draft", detail: "Editing" },
        selection,
      ),
    ).toEqual({
      kind: "item",
      label: "Draft",
      detail: "Selected excerpt text",
    });
  });

  it("includes bounded current item content without an editor selection", () => {
    const context = appendAssistantSelectionContext("Item is open.", {
      title: "Why local files matter",
      excerpt: "A short introduction.",
      body: "Body text",
    });

    expect(context).toContain('Title: "Why local files matter"');
    expect(context).toContain('Excerpt: "A short introduction."');
    expect(context).toContain('Body: "Body text"');
    expect(context).toContain("The full current item is included above.");
  });
});
