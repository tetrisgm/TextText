import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspaceShell = readFileSync(
  new URL("../../PostWorkspaceShell.tsx", import.meta.url),
  "utf8",
);

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
