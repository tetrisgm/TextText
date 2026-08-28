import { describe, expect, it } from "vitest";

import {
  adaptCollectionToFields,
  compileItemTypeBlueprint,
  itemTypeBlueprintSchema,
  type ItemTypeBlueprint,
} from "@/lib/presentation/item-type-blueprint";

/**
 * The habit tracker case. A brief asking to "show me the year as a grid of
 * days" produced a look with no fields at all and an index that errored,
 * because the heatmap threw, the model was asked to repair it, and it answered
 * by removing everything. A dated list is a worse answer than the grid and a
 * far better one than an empty page.
 */
// Raw input, not a parsed blueprint: the schema fills in every default, and
// typing the override as the parsed shape would demand them all here.
function blueprint(over: Record<string, unknown>): ItemTypeBlueprint {
  return itemTypeBlueprintSchema.parse({
    name: "Runs",
    fields: [],
    collection: { layout: "list" },
    ...over,
  });
}

describe("a layout the fields cannot support", () => {
  it("reaches for the date field the heatmap needs", () => {
    const { blueprint: adapted, adjustments } = adaptCollectionToFields(
      blueprint({
        fields: [
          { id: "ran", label: "Date", type: "date" },
          { id: "distance", label: "Distance", type: "number" },
        ],
        collection: { layout: "heatmap" },
      }),
    );
    expect(adapted.collection.layout).toBe("heatmap");
    expect(adapted.collection.dateBy).toBe("ran");
    expect(adjustments[0]?.change).toContain("ran");
  });

  it("falls back to a list when there is no date at all", () => {
    const { blueprint: adapted, adjustments } = adaptCollectionToFields(
      blueprint({
        fields: [{ id: "distance", label: "Distance", type: "number" }],
        collection: { layout: "calendar" },
      }),
    );
    expect(adapted.collection.layout).toBe("list");
    expect(adjustments[0]?.reason).toContain("no date field");
  });

  it("finds the single-select a board needs", () => {
    const { blueprint: adapted } = adaptCollectionToFields(
      blueprint({
        fields: [
          {
            id: "status",
            label: "Status",
            type: "enum",
            options: [
              { value: "todo", label: "To do" },
              { value: "done", label: "Done" },
            ],
          },
        ],
        collection: { layout: "board" },
      }),
    );
    expect(adapted.collection.groupBy).toBe("status");
  });

  it("drops a pointer at a field of the wrong kind", () => {
    const { blueprint: adapted, adjustments } = adaptCollectionToFields(
      blueprint({
        fields: [{ id: "note", label: "Note", type: "text" }],
        collection: { layout: "list", dateBy: "note" },
      }),
    );
    expect(adapted.collection.dateBy).toBeUndefined();
    expect(adjustments[0]?.change).toContain("note");
  });

  it("leaves a blueprint that already validates completely alone", () => {
    const original = blueprint({
      fields: [{ id: "ran", label: "Date", type: "date" }],
      collection: { layout: "heatmap", dateBy: "ran" },
    });
    const { blueprint: adapted, adjustments } = adaptCollectionToFields(original);
    expect(adjustments).toEqual([]);
    expect(adapted).toEqual(original);
  });

  it("compiles what used to throw", () => {
    expect(() =>
      compileItemTypeBlueprint(
        {
          name: "Runs",
          fields: [
            { id: "ran", label: "Date", type: "date" },
            { id: "distance", label: "Distance", type: "number" },
          ],
          collection: { layout: "heatmap" },
        },
        { id: "custom.runs" },
      ),
    ).not.toThrow();
  });

  it("adapts a named view, not only the folder view", () => {
    const { adjustments } = adaptCollectionToFields(
      blueprint({
        fields: [{ id: "ran", label: "Date", type: "date" }],
        collection: {
          layout: "list",
          views: [{ id: "year", name: "Year", layout: "heatmap" }],
        },
      }),
    );
    expect(adjustments.some((entry) => entry.change.includes("Year"))).toBe(true);
  });
});
