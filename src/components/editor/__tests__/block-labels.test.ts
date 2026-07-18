import { describe, expect, it } from "vitest";
import { EDITOR_BLOCK_LABELS } from "@/components/editor/block-labels";

describe("editor block labels", () => {
  it("uses document hierarchy names without changing block identities", () => {
    expect(EDITOR_BLOCK_LABELS).toEqual({
      body: "Body",
      subtitle: "Subtitle",
      heading1: "Heading",
      heading2: "Subheading",
      heading3: "Sub-subheading",
    });
    expect(Object.values(EDITOR_BLOCK_LABELS).join(" ")).not.toMatch(
      /Heading [123]/,
    );
  });
});
