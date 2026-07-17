import { describe, expect, it } from "vitest";
import type { Folder } from "@/lib/content";
import {
  workspaceEscapeTarget,
  workspaceHierarchyUpTarget,
} from "@/lib/workspace-navigation";

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
});
