import { describe, expect, it } from "vitest";
import {
  displayModeForCollectionView,
  selectCollectionView,
} from "@/lib/presentation/collection-views";
import { compileItemTypeBlueprint } from "@/lib/presentation/item-type-blueprint";

function taskCollection() {
  return compileItemTypeBlueprint(
    {
      name: "Tasks",
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
        { id: "due", label: "Due", type: "date" },
      ],
      item: { shape: "task" },
      collection: {
        layout: "list",
        summaryFields: ["status", "due"],
        sortBy: "updatedAt",
        views: [
          {
            id: "board",
            name: "Board",
            layout: "board",
            columns: 3,
            groupBy: "status",
            filters: [{ field: "status", op: "neq", value: "done" }],
            sort: [{ field: "due", direction: "asc" }],
          },
          {
            id: "calendar",
            name: "Calendar",
            layout: "calendar",
            dateBy: "due",
          },
        ],
      },
    },
    { id: "saved-task-views" },
  ).collection;
}

describe("collection views", () => {
  it("selects a named query and layout without mutating the base", () => {
    const base = taskCollection();
    const board = selectCollectionView(base, "board");

    expect(board).toMatchObject({
      layout: "board",
      columns: 3,
      groupBy: "content.fields.status",
      filters: [
        { field: "content.fields.status", op: "neq", value: "done" },
      ],
      sort: [{ field: "content.fields.due", direction: "asc" }],
    });
    expect(base.layout).toBe("list");
    expect(base.groupBy).toBeUndefined();
  });

  it("keeps the base for an unknown view and maps named layouts to display modes", () => {
    const base = taskCollection();
    expect(selectCollectionView(base, "missing")).toBe(base);
    expect(displayModeForCollectionView(base.views[0], "column")).toBe("list");
    expect(
      displayModeForCollectionView(
        { ...base.views[0]!, layout: "cards" },
        "list",
      ),
    ).toBe("grid");
    expect(displayModeForCollectionView(undefined, "column")).toBe("column");
  });
});
