import { describe, expect, it } from "vitest";
import type { Folder } from "@/lib/content";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import { projectTrashView } from "@/lib/trash-view";

function folder(id: string, parentId?: string): Folder {
  return {
    id,
    name: id,
    path: parentId ? `Root/${id}` : id,
    mode: "notes",
    position: 0,
    parentId,
  };
}

function post(id: string, folderId?: string): WorkspacePoolPost {
  return {
    id,
    blogId: "workspace-1",
    folderId,
    type: "note",
    slug: id,
    title: id,
    status: "draft",
  };
}

describe("Trash hierarchy projection", () => {
  it("shows a deleted hierarchy once and hides its nested items", () => {
    const root = folder("root");
    const child = folder("child", root.id);
    const projection = projectTrashView(
      [root, child],
      [post("root-post", root.id), post("child-post", child.id)],
    );
    expect(projection.rootFolders.map((entry) => entry.id)).toEqual(["root"]);
    expect(projection.visiblePosts).toEqual([]);
  });

  it("keeps individually deleted posts visible when their parent is active", () => {
    const projection = projectTrashView(
      [],
      [post("standalone", "active-folder")],
    );
    expect(projection.rootFolders).toEqual([]);
    expect(projection.visiblePosts.map((entry) => entry.id)).toEqual([
      "standalone",
    ]);
  });

  it("keeps a root-level deleted post visible", () => {
    expect(projectTrashView([], [post("root-post")]).visiblePosts).toHaveLength(
      1,
    );
  });
});
