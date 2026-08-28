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

    expect(prompt).toContain("preview_item_type with a complete blueprint");
    expect(prompt).toContain("quality review rejects");
    expect(prompt).toContain("Do not call any other tool");
    expect(prompt).toContain("Target folder: Essays");
    expect(prompt).toContain("Medium-like publication");
    expect(prompt).toContain('"collection"');
    expect(prompt).toContain("blueprint_json");
    expect(prompt).toContain("read-only computed rollups");
    expect(prompt).toContain("named folder views");
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

  it("returns actionable quality feedback for an incomplete design", () => {
    expect(() =>
      parseNativeItemTypePreviewArguments({
        blueprint_json: JSON.stringify({
          name: "Work",
          fields: [],
          item: {
            shape: "task",
            showBody: false,
            showMetadata: false,
            showTags: false,
          },
          collection: {
            layout: "board",
            columns: 3,
            summaryFields: [],
            sortBy: "updatedAt",
            sortDirection: "desc",
          },
        }),
      }),
    ).toThrow("Group a board by a select property");
  });

  it("rejects cross-field errors before accepting a native preview", () => {
    const notes = ITEM_TYPE_STARTERS[2]!.blueprint;
    const invalid = {
      ...notes,
      collection: { ...notes.collection, layout: "heatmap" },
    };

    expect(() =>
      parseNativeItemTypePreviewArguments({
        blueprint_json: JSON.stringify(invalid),
      }),
    ).toThrow("Choose a date property for the heatmap");
  });
});
