import { describe, expect, it } from "vitest";
import type { Folder } from "@/lib/content";
import {
  rememberedRootFolderPath,
  rootFolderPathForSelection,
  shouldClearWorkspaceSelection,
  shouldMoveSelectionIntoSidebar,
  workspaceHrefWithSearchReturn,
  workspaceEscapeTarget,
  workspaceHierarchyUpTarget,
  workspaceSearchHref,
  workspaceSearchLocationFromUrl,
  workspaceSearchReturnFromUrl,
} from "@/lib/workspace-navigation";
import { STARRED_FOLDER_PATH } from "@/lib/workspace-paths";

const folders: Folder[] = [
  { id: "blog", name: "Blog", path: "blog", mode: "blog", position: 0 },
  {
    id: "ideas",
    name: "Ideas",
    path: "blog/ideas",
    mode: "blog",
    parentId: "blog",
    position: 1,
  },
];

describe("workspace hierarchy navigation", () => {
  it("consumes hierarchy up at home without creating a history target", () => {
    expect(workspaceHierarchyUpTarget({ level: "root" }, folders)).toEqual({
      kind: "none",
    });
  });

  it("moves item to folder, nested folder to parent, then root folder home", () => {
    expect(
      workspaceHierarchyUpTarget(
        {
          level: "post",
          folderPath: "blog/ideas",
          postId: "post-1",
        },
        folders,
      ),
    ).toEqual({ kind: "folder", folderPath: "blog/ideas" });
    expect(
      workspaceHierarchyUpTarget(
        { level: "section", folderPath: "blog/ideas" },
        folders,
      ),
    ).toEqual({ kind: "folder", folderPath: "blog" });
    expect(
      workspaceHierarchyUpTarget(
        { level: "section", folderPath: "blog" },
        folders,
      ),
    ).toEqual({ kind: "home" });
  });

  it("treats Starred as a personal virtual location below home", () => {
    expect(
      workspaceHierarchyUpTarget(
        { level: "starred", folderPath: STARRED_FOLDER_PATH },
        folders,
      ),
    ).toEqual({ kind: "home" });
  });

  it("escapes notes to their folder and article editors to read view", () => {
    const edit = { level: "edit" as const, folderPath: "blog", postId: "p1" };
    expect(workspaceEscapeTarget(edit, folders, "note")).toEqual({
      kind: "folder",
      folderPath: "blog",
    });
    expect(workspaceEscapeTarget(edit, folders, "article")).toEqual({
      kind: "read",
      folderPath: "blog",
      postId: "p1",
    });
  });

  it("keeps browser history separate from hierarchy and returns items to search", () => {
    const search = { query: "cedar plan", source: "query" as const };
    const searchHref = workspaceSearchHref("/t/writer", search);
    const itemHref = workspaceHrefWithSearchReturn(
      "/t/writer/cedar?edit=1&id=p1",
      search,
    );
    expect(searchHref).toBe("/t/writer?q=cedar+plan");
    expect(
      workspaceSearchLocationFromUrl(
        new URL(searchHref, "https://write.local"),
      ),
    ).toEqual(search);
    expect(
      workspaceSearchReturnFromUrl(
        new URL(itemHref, "https://write.local"),
      ),
    ).toEqual(search);
    expect(
      workspaceHierarchyUpTarget(
        {
          level: "post",
          folderPath: "blog/ideas",
          postId: "p1",
          returnToSearch: search,
        },
        folders,
      ),
    ).toEqual({ kind: "search", ...search });
    expect(
      workspaceHierarchyUpTarget({ level: "search", ...search }, folders),
    ).toEqual({ kind: "none" });
  });

  it("serializes tag views as virtual workspace search levels", () => {
    const tag = { query: "deep work", source: "tag" as const };
    const href = workspaceSearchHref("/@writer", tag);
    expect(href).toBe("/@writer?tag=deep+work");
    expect(
      workspaceSearchLocationFromUrl(new URL(href, "https://write.local")),
    ).toEqual(tag);
    const returned = workspaceHrefWithSearchReturn("/@writer/post", tag);
    expect(
      workspaceSearchReturnFromUrl(
        new URL(returned, "https://write.local"),
      ),
    ).toEqual(tag);
  });

  it("remembers the last root folder and rejects a stale remembered path", () => {
    expect(rootFolderPathForSelection(folders, "blog/ideas")).toBe("blog");
    expect(rememberedRootFolderPath(folders, "blog")).toBe("blog");
    expect(rememberedRootFolderPath(folders, "missing")).toBeNull();
  });

  it("hands a left-edge body selection to the sidebar", () => {
    expect(
      shouldMoveSelectionIntoSidebar({
        direction: "left",
        hasCurrentItem: true,
        neighborChanged: false,
      }),
    ).toBe(true);
    expect(
      shouldMoveSelectionIntoSidebar({
        direction: "right",
        hasCurrentItem: true,
        neighborChanged: false,
      }),
    ).toBe(false);
  });

  it("clears selection only for an unhandled primary background click", () => {
    expect(
      shouldClearWorkspaceSelection({
        button: 0,
        defaultPrevented: false,
        insideInteractive: false,
      }),
    ).toBe(true);
    expect(
      shouldClearWorkspaceSelection({
        button: 0,
        defaultPrevented: false,
        insideInteractive: true,
      }),
    ).toBe(false);
  });
});
