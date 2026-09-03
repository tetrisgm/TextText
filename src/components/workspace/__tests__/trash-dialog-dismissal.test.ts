import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = [
  "../../PostWorkspaceShell.tsx",
  "../WorkspaceSidebarChrome.tsx",
  "../WorkspaceRootPages.tsx",
  "../WorkspaceSpecialPages.tsx",
  "../WorkspaceItemViews.tsx",
  "../../../lib/workspace/local-view.ts",
  "../../../lib/workspace/draft-sessions.ts",
]
  .map((p) => readFileSync(new URL(p, import.meta.url), "utf8"))
  .join("\n");
const serverActionsSource = readFileSync(
  new URL("../../../app/editor/actions.ts", import.meta.url),
  "utf8",
);
const itemActionsSource = readFileSync(
  new URL("../WorkspaceItemActions.tsx", import.meta.url),
  "utf8",
);
const folderPageSource = readFileSync(
  new URL("../../FolderPage.tsx", import.meta.url),
  "utf8",
);

describe("Trash confirmation dismissal", () => {
  it("dismisses multi-item confirmation before starting deletion", () => {
    expect(shellSource).toMatch(
      /setDeleteOpen\(false\);\s+setBusy\(true\);\s+void Promise\.resolve\(onDelete\(\)\)/,
    );
  });

  it("dismisses command-layer confirmation before deleting selected items", () => {
    expect(shellSource).toMatch(
      /setPendingDeletePostIds\(\[\]\);\s+if \(posts\.length === 0\)[\s\S]*?void deleteWorkspaceItems\(posts\)/,
    );
  });

  it("dismisses item and folder confirmations before their requests", () => {
    expect(itemActionsSource).toMatch(
      /setDeleteOpen\(false\);\s+setOpen\(false\);\s+setBusy\(true\)/,
    );
    expect(folderPageSource).toMatch(
      /setDeleteOpen\(false\);\s+setDeleting\(true\)/,
    );
  });

  it("dismisses permanent-delete confirmations before network work", () => {
    expect(shellSource).toMatch(
      /const target = deleteTarget;\s+setDeleteTarget\(null\);\s+setBusyId\(target\.id\)/,
    );
    expect(shellSource).toMatch(
      /setEmptyTrashOpen\(false\);\s+setBusyId\("empty-trash"\)/,
    );
    expect(shellSource).toContain('fetch("/api/workspace/trash"');
  });

  it("keeps every Trash mutation off deployment-bound Server Actions", () => {
    expect(shellSource).toContain(
      'runTrashOperation(\n          "trash-posts"',
    );
    expect(shellSource).toContain(
      'runTrashOperation("restore-post", handle, postId)',
    );
    expect(shellSource).toContain(
      'runTrashOperation("restore-folder", handle, folderId)',
    );
    expect(shellSource).toContain('runTrashOperation("empty", handle)');
    expect(shellSource).toMatch(
      /target\.kind === "post" \? "delete-post" : "delete-folder"/,
    );
    for (const action of [
      "emptyTrashAction",
      "restoreEditablePostAction",
      "restoreFolderAction",
      "permanentlyDeleteEditablePostAction",
      "permanentlyDeleteFolderAction",
      "deleteEditablePostsAction",
    ]) {
      expect(shellSource).not.toContain(action);
      expect(serverActionsSource).not.toContain(`function ${action}(`);
    }
  });
});
