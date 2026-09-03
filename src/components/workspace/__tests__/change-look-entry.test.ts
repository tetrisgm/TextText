import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Goal one's second half needed an entry point, and had none: the server
 * action, the studio prop and the timeline all took a look to reopen, and
 * nothing in the workspace offered it to a person. Everything below is
 * reachable only through the shell, which no test can mount here, so this
 * checks the wiring exists rather than leaving it to be discovered missing.
 */
const SHELL = [
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

describe("changing a look from the workspace", () => {
  it("offers it on a folder, beside building one", () => {
    expect(SHELL).toContain("Change this look");
    expect(SHELL).toContain("onChangeItemType");
  });

  it("reads the design before opening the studio on it", () => {
    // Opening blind would show the person an empty designer and call it their
    // look. The read can also answer "this one was not designed here".
    expect(SHELL).toContain("readItemTypeForEditAction");
    expect(SHELL).toContain("setItemTypeStudioEditing");
  });

  it("hands the studio the look and the version it was read at", () => {
    // Without baseVersion the save is a blind write, and the compare-and-swap
    // in updateWorkspaceItemType has nothing to compare.
    expect(SHELL).toMatch(/editing=\{itemTypeStudioEditing/);
    expect(SHELL).toContain("baseVersion: read.version");
  });

  it("says why, for each way a look can fail to reopen", () => {
    expect(SHELL).toContain("built-in look");
    expect(SHELL).toContain("older version of the designer");
    expect(SHELL).toContain("could not be read");
    expect(SHELL).toContain("saved from a document, imported, or duplicated");
  });

  it("clears the look being edited when the studio closes", () => {
    // Otherwise the next "Build with AI" opens on the last look edited and
    // saves a new version of it instead of creating anything.
    expect(SHELL).toMatch(/setItemTypeStudioEditing\(null\)/);
  });
});
