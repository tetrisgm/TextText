import { describe, expect, it } from "vitest";
import { workspaceReferenceChoices } from "@/lib/presentation/workspace-reference-choices";

describe("workspaceReferenceChoices", () => {
  it("uses canonical ids, readable labels, and a stable sort", () => {
    expect(
      workspaceReferenceChoices(
        [
          { id: "b", title: "Zed", type: "article" },
          { id: "a", title: "", type: "media_post" },
          { id: "c", title: "Amy", type: "note" },
        ],
        "b",
      ),
    ).toEqual([
      { id: "c", label: "Amy", description: "Note" },
      { id: "a", label: "Untitled", description: "Media Post" },
    ]);
  });
});
