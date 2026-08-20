import { describe, expect, it } from "vitest";
import { workspaceToolProgress } from "../tool-progress";

describe("workspaceToolProgress", () => {
  it("names the grounded writing loop instead of provider internals", () => {
    expect(workspaceToolProgress("list_items", { folder_path: "notes" })).toBe(
      "Reading items in notes",
    );
    expect(workspaceToolProgress("review_brief_sources", { id: "brief" })).toBe(
      "Checking source versions against the claims",
    );
    expect(
      workspaceToolProgress("create_item", {
        template_id: "texttext.brief",
      }),
    ).toBe("Building the sourced Living brief");
  });

  it("names a targeted section update and ignores internal tools", () => {
    expect(
      workspaceToolProgress("update_item", { section: "Recommendation" }),
    ).toBe("Updating only Recommendation");
    expect(workspaceToolProgress("get_workspace", {})).toBeNull();
  });
});
