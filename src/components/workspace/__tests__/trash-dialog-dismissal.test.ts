import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(
  new URL("../../PostWorkspaceShell.tsx", import.meta.url),
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
const blogControlsSource = readFileSync(
  new URL("../../BlogHomeEditorControls.tsx", import.meta.url),
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
    expect(blogControlsSource).toMatch(
      /setTrashDialogOpen\(false\);\s+setPending\("trash"\)/,
    );
  });

  it("dismisses permanent-delete confirmations before network work", () => {
    expect(shellSource).toMatch(
      /const target = deleteTarget;\s+setDeleteTarget\(null\);\s+setBusyId\(target\.id\)/,
    );
    expect(shellSource).toMatch(
      /setEmptyTrashOpen\(false\);\s+setBusyId\("empty-trash"\)/,
    );
  });
});
