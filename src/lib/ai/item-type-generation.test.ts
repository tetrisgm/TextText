import { describe, expect, it } from "vitest";
import {
  ITEM_TYPE_BLUEPRINT_FORMAT,
  honorNamedStyleReference,
  itemTypeBlueprintRepairPrompt,
  parseItemTypeBlueprintText,
} from "@/lib/ai/item-type-generation";
import { ITEM_TYPE_STARTERS } from "@/lib/presentation/item-type-blueprint";

describe("item-type text generation", () => {
  it("describes both item and folder output", () => {
    expect(ITEM_TYPE_BLUEPRINT_FORMAT).toContain('"item"');
    expect(ITEM_TYPE_BLUEPRINT_FORMAT).toContain('"collection"');
    expect(ITEM_TYPE_BLUEPRINT_FORMAT).toContain('"groupBy"');
    expect(ITEM_TYPE_BLUEPRINT_FORMAT).toContain('"type": "computed"');
    expect(ITEM_TYPE_BLUEPRINT_FORMAT).toContain('"people" | "recurrence"');
    expect(ITEM_TYPE_BLUEPRINT_FORMAT).toContain('"workflow"');
    expect(ITEM_TYPE_BLUEPRINT_FORMAT).toContain('"views"');
    expect(ITEM_TYPE_BLUEPRINT_FORMAT).toContain('"filters"');
  });

  it("accepts plain or fenced model JSON and validates it", () => {
    const blueprint = ITEM_TYPE_STARTERS[2]!.blueprint;
    const json = JSON.stringify(blueprint);
    expect(parseItemTypeBlueprintText(json)).toEqual(blueprint);
    expect(parseItemTypeBlueprintText(`Here it is:\n\`\`\`json\n${json}\n\`\`\``)).toEqual(
      blueprint,
    );
  });

  it("gives a failed draft a bounded repair instruction", () => {
    const prompt = itemTypeBlueprintRepairPrompt({
      error: new Error("collection.groupBy is required"),
      generated: "{}",
      request: "A task board",
    });
    expect(prompt).toContain("A task board");
    expect(prompt).toContain("collection.groupBy is required");
    expect(prompt).toContain("Return JSON only");
  });

  it("keeps an explicitly named visual reference in the validated result", () => {
    const blueprint = ITEM_TYPE_STARTERS[2]!.blueprint;
    const withoutReference = { ...blueprint, styleReference: "Warm paper" };
    expect(
      honorNamedStyleReference(withoutReference, "Make this like Apple Notes")
        .styleReference,
    ).toBe("Apple Notes: Warm paper");
  });
});
