import { describe, expect, it } from "vitest";
import {
  ITEM_TYPE_STARTERS,
  itemTypeBlueprintSchema,
} from "@/lib/presentation/item-type-blueprint";
import {
  assessItemTypeQuality,
  itemTypeQualityRevisionPrompt,
} from "@/lib/presentation/item-type-quality";

describe("item-type quality", () => {
  it("accepts the complete built-in starting points", () => {
    for (const starter of ITEM_TYPE_STARTERS) {
      const report = assessItemTypeQuality(starter.blueprint);
      expect(report.passes, `${starter.label}: ${JSON.stringify(report)}`).toBe(
        true,
      );
      expect(report.score).toBeGreaterThanOrEqual(76);
    }
  });

  it("finds a structurally valid but unusable board", () => {
    const blueprint = itemTypeBlueprintSchema.parse({
      name: "Work",
      audience: "private",
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
    });
    const report = assessItemTypeQuality(blueprint);
    expect(report.passes).toBe(false);
    expect(report.findings.map((item) => item.code)).toEqual(
      expect.arrayContaining(["empty-item", "board-without-status"]),
    );
    expect(itemTypeQualityRevisionPrompt(blueprint, report)).toContain(
      "Group a board by a select property",
    );
  });

  it("treats polish notes as suggestions rather than blockers", () => {
    const blueprint = itemTypeBlueprintSchema.parse({
      name: "Journal",
      audience: "private",
      fields: [],
      item: {
        shape: "note",
        showBody: true,
        showMetadata: false,
        showTags: false,
      },
      collection: {
        layout: "list",
        columns: 1,
        summaryFields: [],
        sortBy: "updatedAt",
        sortDirection: "desc",
      },
    });
    const report = assessItemTypeQuality(blueprint);
    expect(report.passes).toBe(true);
    expect(report.findings.every((item) => item.severity === "suggestion")).toBe(
      true,
    );
  });

  it("blocks a heatmap without its placement date", () => {
    const notes = ITEM_TYPE_STARTERS[2]!.blueprint;
    const blueprint = itemTypeBlueprintSchema.parse({
      ...notes,
      collection: { ...notes.collection, layout: "heatmap" },
    });
    const report = assessItemTypeQuality(blueprint);
    expect(report.passes).toBe(false);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "heatmap-without-date" }),
    );
  });
});
