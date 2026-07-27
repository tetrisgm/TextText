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
const broadsheetStyles = readFileSync(
  new URL("../../../styles/broadsheet.css", import.meta.url),
  "utf8",
);
const spatialCardSource = readFileSync(
  new URL("../spatial-card.ts", import.meta.url),
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
    expect(folderSource).toContain("onPointerMove={updateSpatialCardTilt}");
    expect(shellSource).toContain("onPointerMove={updateSpatialCardTilt}");
    expect(broadsheetStyles).toContain(
      ".workspace-recent.is-view-grid .workspace-item-option",
    );
    expect(broadsheetStyles).toContain("perspective: 1800px");
    expect(broadsheetStyles).toContain("rotateX(var(--card-rx))");
    expect(broadsheetStyles).toContain("translate3d(0, -3px, 0)");
    expect(broadsheetStyles).toContain(
      ".workspace-recent.is-view-grid .workspace-item-option.is-spatial-hover",
    );
    expect(broadsheetStyles).not.toContain(
      ".workspace-item-option:hover {\n    transform: none;",
    );
    expect(spatialCardSource).toContain(
      'card.classList.add("is-spatial-hover")',
    );
    expect(spatialCardSource).toContain("requestAnimationFrame");
    expect(spatialCardSource).toContain("new WeakMap");
    expect(spatialCardSource).toContain("card.getBoundingClientRect()");
    expect(spatialCardSource).toContain('event.pointerType === "touch"');
    expect(spatialCardSource).not.toContain(
      'event.pointerType !== "mouse"',
    );
  });

  it("uses the same universal item composer on Home and inside folders", () => {
    expect(folderSource).toContain("export function UniversalItemComposer");
    expect(shellSource).toContain("<UniversalItemComposer");
    expect(shellSource).toContain('aria-label="Choose a folder"');
    expect(shellSource).toContain("onCreateItem={onCreateItem}");
  });

  it("keeps the library collection-first and embeds the destination in the capture row", () => {
    expect(shellSource).toContain('className="workspace-library-header"');
    expect(shellSource).toContain('id="workspace-root-title">Library</h1>');
    expect(shellSource).toContain('"library-v2"');
    expect(shellSource).toContain('"grid"');
    expect(shellSource).toContain(">Collections</p>");
    expect(shellSource).toContain('aria-label="Filter library items"');
    expect(shellSource).toMatch(
      /<UniversalItemComposer[\s\S]*?leading=\{[\s\S]*?workspace-root-create-destination/,
    );
    expect(folderSource).toContain("const defaultViewMode: FolderViewMode = \"grid\"");
    expect(folderSource).toContain("`folder:v2:${folder.id}`");
    expect(folderSource).toContain('className="post-folder-page-count"');
    expect(folderSource).toMatch(/\{items\.length\} \{items\.length/);
  });
});
