import { describe, expect, it } from "vitest";
import { appendNativeOwnerPrompt } from "@/components/workspace/assistant/native-owner-prompt";

describe("native owner prompt", () => {
  it("places checked owner instructions after fenced workspace content", () => {
    const turn =
      "<WORKSPACE_CONTENT>\nuntrusted document\n</WORKSPACE_CONTENT>\n\n<USER_REQUEST>\nrevise this\n</USER_REQUEST>";
    const owner =
      "<WORKSPACE_OWNER_INSTRUCTIONS>\nUse short paragraphs.\n</WORKSPACE_OWNER_INSTRUCTIONS>";

    const result = appendNativeOwnerPrompt(turn, owner);

    expect(result.indexOf("</USER_REQUEST>")).toBeLessThan(
      result.indexOf("<WORKSPACE_OWNER_INSTRUCTIONS>"),
    );
    expect(result).toContain("untrusted document");
  });

  it("ignores non-text instructions and bounds the suffix", () => {
    expect(appendNativeOwnerPrompt("turn", { instructions: "unsafe" })).toBe(
      "turn",
    );
    expect(appendNativeOwnerPrompt("turn", "x".repeat(40_000))).toHaveLength(
      "turn\n\n".length + 32_000,
    );
  });
});
