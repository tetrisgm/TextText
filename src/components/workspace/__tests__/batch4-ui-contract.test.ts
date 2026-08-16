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
    expect(folderSource).toContain('folder.mode === "blog"');
    expect(folderSource).toContain("blog-folder-feed");
    expect(folderSource).toContain("blog-folder-feed-title");
    expect(folderSource).toContain('folder.mode !== "blog"');
    expect(broadsheetStyles).toContain(".blog-folder-feed-item");
    expect(broadsheetStyles).toContain(".blog-folder-feed-cover");
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
    expect(shellSource).toContain("destinations={creationFolders}");
    expect(shellSource).toContain("onCreateItem={onCreateItem}");
  });

  it("keeps the library collection-first and embeds the destination in the capture row", () => {
    expect(shellSource).toContain('className="workspace-library-header"');
    expect(shellSource).toContain('id="workspace-root-title">Library</h1>');
    // Home's layout is the workspace's one stored layout choice: it is read
    // from the workspace and written back to it, not kept in this browser.
    expect(shellSource).toContain("useState<BlogHomeView>(\n    pool.blog.homeLayout,\n  )");
    expect(shellSource).toContain("updateBlogAction({ homeLayout }, pool.blog.handle)");
    expect(shellSource).toContain(">Collections</p>");
    expect(shellSource).toContain('aria-label="Filter library items"');
    expect(shellSource).toContain('className="workspace-library-toolbar"');
    expect(shellSource).toContain("{itemCounts[value]}");
    expect(shellSource).toMatch(
      /workspace-library-toolbar[\s\S]*?workspace-library-filters[\s\S]*?workspace-library-controls/,
    );
    // Creating is one action: the capture row has no destination or look
    // control to answer before you can type.
    expect(shellSource).not.toContain("workspace-root-create-destination");
    expect(shellSource).not.toContain('aria-label="Choose a folder"');
    expect(folderSource).not.toContain('aria-label="Choose a look"');
    // Notes and bookmarks still fall back to a list. The folder's look now
    // gets first say, so a look declaring `list` is not overridden into a
    // grid by the mode default.
    expect(folderSource).toContain(
      'folder.mode === "notes" || folder.mode === "bookmarks"',
    );
    expect(folderSource).toContain("lookLayout");
    expect(folderSource).toContain("`folder:v3:${folder.id}`");
    expect(folderSource).toContain('className="post-folder-page-count"');
    expect(folderSource).toMatch(/\{items\.length\} \{items\.length/);
    expect(broadsheetStyles).toContain(
      "Home and folder cards use one collection shell.",
    );
  });
});
