import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const folderSource = readFileSync(
  new URL("../../FolderPage.tsx", import.meta.url),
  "utf8",
);
const shellSource = [
  "../../PostWorkspaceShell.tsx",
  "../WorkspaceSidebarChrome.tsx",
  "../WorkspaceRootPages.tsx",
  "../WorkspaceSpecialPages.tsx",
  "../WorkspaceItemViews.tsx",
  // The editor moved into its own module so it can be loaded on demand;
  // these contracts follow it.
  "../WorkspaceItemEditor.tsx",
  "../../../lib/workspace/local-view.ts",
  "../../../lib/workspace/draft-sessions.ts",
]
  .map((p) => readFileSync(new URL(p, import.meta.url), "utf8"))
  .join("\n");

describe("workspace media loading", () => {
  it("does not eagerly fetch offscreen folder-feed media", () => {
    expect(folderSource).toContain('preload="none"');
    expect(folderSource).toContain('loading="lazy"');
  });

  it("keeps the first capture tile eager and defers the remaining page", () => {
    expect(shellSource).toContain(
      'loading={tile.index === 0 ? "eager" : "lazy"}',
    );
  });
});
