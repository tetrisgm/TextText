import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspaceShell = [
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

describe("canonical workspace document guard", () => {
  it("never treats a failed document request as an empty editor baseline", () => {
    expect(workspaceShell).toContain(
      'return documentState.entry.status === "error"',
    );
    expect(workspaceShell).not.toContain(
      'bodyState.entry.status === "error"',
    );
    expect(workspaceShell).toContain(
      "documentState.entry.document.document",
    );
  });

  it("updates and acknowledges the complete canonical document", () => {
    expect(workspaceShell).toContain(
      "updatePostDocument(pool.blogId, poolPost.id, nextDocument)",
    );
    expect(workspaceShell).toContain("acknowledgePostDocument(");
    expect(workspaceShell).toContain("nextDocument,\n        revision,");
  });
});
