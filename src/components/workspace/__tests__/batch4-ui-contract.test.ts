import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actionBarSource = readFileSync(
  new URL("../../PostActionBar.tsx", import.meta.url),
  "utf8",
);
const folderSource = readFileSync(
  new URL("../../FolderPage.tsx", import.meta.url),
  "utf8",
);
const readerSource = readFileSync(
  new URL("../../Reader.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../../PostWorkspaceShell.tsx", import.meta.url),
  "utf8",
);

describe("batch 4 workspace UI contract", () => {
  it("keeps reader prose selectable instead of starting marquee selection", () => {
    expect(shellSource).toContain(
      ".reader, .reader-prose, [data-static-prose]",
    );
  });

  it("uses anchored reader comments without mounting the retired sheet", () => {
    expect(shellSource).toContain("<ReaderComments");
    expect(actionBarSource).not.toContain("CommentsDialog");
    expect(actionBarSource).not.toContain("post-comments-button");
  });

  it("keeps bookmark recapture edit-only and exposes only Reader and Full views", () => {
    expect(actionBarSource).toMatch(
      /canManagePost\s*&&\s*props\.mode === "edit"[\s\S]*?<BookmarkRecaptureControl/,
    );
    expect(actionBarSource).toMatch(/>\s*Reader\s*</);
    expect(actionBarSource).toMatch(/>\s*Full\s*</);
    expect(actionBarSource).not.toContain("Show full capture");
    expect(actionBarSource).not.toContain("post-bookmark-original-button");
    expect(readerSource).toContain("reader-bookmark-source");
    expect(readerSource).toContain("originally captured from:");
  });

  it("uses the shared action-bar search for roots, folders, and items", () => {
    expect(shellSource).toContain("<WorkspaceActionSearch");
    expect(folderSource).toContain("<WorkspaceActionSearch");
    expect(actionBarSource).toContain("<WorkspaceActionSearch");
    expect(shellSource).toContain("<ReaderFindHighlights query={findQuery}");
  });
});
