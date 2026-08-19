import { describe, expect, it } from "vitest";
import {
  nativeItemTypeDesignPrompt,
  parseNativeItemTypePreviewArguments,
} from "@/lib/ai/native-item-type";
import { ITEM_TYPE_STARTERS } from "@/lib/presentation/item-type-blueprint";

describe("native item-type design", () => {
  it("asks the connected agent for a preview without saving", () => {
    const prompt = nativeItemTypeDesignPrompt({
      request: "Make a Medium-like publication with author and topic fields",
      folderName: "Essays",
    });

    expect(prompt).toContain("preview_item_type exactly once");
    expect(prompt).toContain("Do not call any other tool");
    expect(prompt).toContain("Target folder: Essays");
    expect(prompt).toContain("Medium-like publication");
    expect(prompt).toContain('"collection"');
    expect(prompt).toContain("blueprint_json");
  });

  it("validates the complete blueprint returned by the native tool", () => {
    const blueprint = ITEM_TYPE_STARTERS[0]!.blueprint;
    expect(
      parseNativeItemTypePreviewArguments({
        blueprint_json: JSON.stringify(blueprint),
      }),
    ).toEqual(blueprint);
    expect(() => parseNativeItemTypePreviewArguments({})).toThrow(
      "did not return an item-type blueprint",
    );
  });
});
