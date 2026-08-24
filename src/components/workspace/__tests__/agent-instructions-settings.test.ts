import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../AgentInstructionsSettings.tsx", import.meta.url),
  "utf8",
);
const workspaceSettings = readFileSync(
  new URL("../WorkspaceSettings.tsx", import.meta.url),
  "utf8",
);

describe("agent instruction settings UI", () => {
  it("keeps durable instructions visible, editable, and removable in Settings", () => {
    expect(workspaceSettings).toContain(
      "<AgentInstructionsSettings handle={blog.handle} />",
    );
    expect(source).toContain("Standing instructions");
    expect(source).toContain("Reusable skills");
    expect(source).toContain("Save instructions");
    expect(source).toContain("Clear all");
    expect(source).toContain("Remove");
  });

  it("explains the authority boundary and explicit skill invocation", () => {
    expect(source).toContain("Only text saved here is");
    expect(source).toContain("remain reference material");
    expect(source).toContain(
      "A skill runs only when your request includes its shortcut",
    );
    expect(source).toContain("/weekly-review");
  });
});
