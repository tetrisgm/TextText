import { describe, expect, it } from "vitest";
import { shouldShowWorkspaceTypeChip } from "@/lib/workspace-item-presentation";

describe("workspace type chips", () => {
  it("hides a type inside its home folder", () => {
    expect(
      shouldShowWorkspaceTypeChip({ postType: "article", folderMode: "blog" }),
    ).toBe(false);
    expect(
      shouldShowWorkspaceTypeChip({ postType: "note", folderMode: "notes" }),
    ).toBe(false);
    expect(
      shouldShowWorkspaceTypeChip({ postType: "bookmark", folderMode: "bookmarks" }),
    ).toBe(false);
  });

  it("shows a type in Recent, search, Starred, and cross-folder views", () => {
    expect(
      shouldShowWorkspaceTypeChip({
        postType: "article",
        folderMode: "blog",
        virtualLocation: true,
      }),
    ).toBe(true);
    expect(
      shouldShowWorkspaceTypeChip({ postType: "note", folderMode: "blog" }),
    ).toBe(true);
  });
});
