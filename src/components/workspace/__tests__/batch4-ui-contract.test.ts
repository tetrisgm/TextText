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
const templateSource = readFileSync(
  new URL("../../../lib/presentation/templates.ts", import.meta.url),
  "utf8",
);
const rendererSource = readFileSync(
  new URL("../../document/DocumentRenderer.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../../PostWorkspaceShell.tsx", import.meta.url),
  "utf8",
);
const viewModeSource = readFileSync(
  new URL("../WorkspaceViewModeControl.tsx", import.meta.url),
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
    expect(templateSource).toContain('href: "content.fields.sourceUrl"');
    expect(rendererSource).toContain("href && isSafeLinkHref(href)");
  });

  it("uses the shared action-bar search for roots, folders, and items", () => {
    expect(shellSource).toContain("<WorkspaceActionSearch");
    expect(folderSource).toContain("<WorkspaceActionSearch");
    expect(actionBarSource).toContain("<WorkspaceActionSearch");
    expect(shellSource).toContain("<ReaderFindHighlights query={findQuery}");
  });

  it("names the image-led grid Cards and uses the shared document collection renderer", () => {
    expect(viewModeSource).toContain('grid: "Cards"');
    expect(folderSource).toContain("<DocumentCollectionRenderer");
    expect(folderSource).toContain(
      "className={`universal-item-collection is-${viewMode}`}",
    );
  });

  it("uses the same universal item composer on Home and inside folders", () => {
    expect(folderSource).toContain("export function UniversalItemComposer");
    expect(shellSource).toContain("<UniversalItemComposer");
    expect(shellSource).toContain('aria-label="Choose a folder"');
    expect(shellSource).toContain("onCreateItem={onCreateItem}");
  });
});
