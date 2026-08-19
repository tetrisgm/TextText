import { describe, expect, it } from "vitest";
import {
  compileItemTypeBlueprint,
  ITEM_TYPE_STARTERS,
} from "@/lib/presentation/item-type-blueprint";

describe("compileItemTypeBlueprint", () => {
  it("builds a Medium-like publishable blog look for items and the folder", () => {
    const template = compileItemTypeBlueprint(
      {
        name: "Essays",
        description: "Long-form writing with a quiet reading experience.",
        styleReference: "Medium",
        audience: "publishable",
        fields: [
          {
            id: "cover",
            label: "Cover",
            type: "image",
            display: "cover",
          },
          {
            id: "topic",
            label: "Topic",
            type: "enum",
            display: "badge",
            options: [
              { value: "design", label: "Design", tone: "accent" },
              { value: "culture", label: "Culture" },
            ],
          },
        ],
        item: {
          shape: "article",
          showBody: true,
          showMetadata: true,
          showTags: true,
        },
        collection: {
          layout: "cards",
          columns: 2,
          summaryFields: ["topic"],
          sortBy: "publishedAt",
          sortDirection: "desc",
        },
        theme: {},
      },
      { id: "essays-abc123" },
    );

    expect(template.theme.typography).toBe("editorial");
    expect(template.theme.bodyScale).toBe("relaxed");
    expect(template.capabilities).toContain("publish");
    expect(template.collection.layout).toBe("cards");
    expect(template.collection.columns).toBe(2);
    expect(template.example?.fields.topic).toBe("design");
    expect(template.item).toMatchObject({ type: "stack" });
  });

  it("builds a Notion-like task board with properties and a live example", () => {
    const template = compileItemTypeBlueprint(
      {
        name: "Launch tasks",
        styleReference: "Notion",
        audience: "private",
        fields: [
          {
            id: "done",
            label: "Done",
            type: "boolean",
            display: "toggle",
          },
          {
            id: "status",
            label: "Status",
            type: "enum",
            display: "badge",
            options: [
              { value: "backlog", label: "Backlog", tone: "neutral" },
              { value: "doing", label: "Doing", tone: "info" },
              { value: "done", label: "Done", tone: "success" },
            ],
          },
          {
            id: "due",
            label: "Due",
            type: "date",
            display: "fact",
          },
        ],
        item: {
          shape: "task",
          icon: "✓",
          showBody: true,
          showMetadata: false,
          showTags: false,
        },
        collection: {
          layout: "board",
          columns: 3,
          groupBy: "status",
          summaryFields: ["done", "status", "due"],
          sortBy: "due",
          sortDirection: "asc",
        },
        theme: {},
      },
      { id: "launch-tasks-abc123" },
    );

    expect(template.collection).toMatchObject({
      layout: "board",
      groupBy: "content.fields.status",
      sort: [{ field: "content.fields.due", direction: "asc" }],
    });
    expect(template.theme.measure).toBe("wide");
    expect(template.example).toMatchObject({
      title: "Plan the launch",
      fields: {
        done: false,
        status: "backlog",
        due: "2026-08-19",
        typeIcon: "✓",
      },
    });
    expect(template.fields).toContainEqual(
      expect.objectContaining({
        id: "typeIcon",
        type: "text",
        visibility: "hidden",
      }),
    );
  });

  it("builds an Apple Notes-like private list without publishing", () => {
    const template = compileItemTypeBlueprint(
      {
        name: "Notes",
        styleReference: "Apple Notes",
        audience: "private",
        fields: [],
        item: {
          shape: "note",
          showBody: true,
          showMetadata: true,
          showTags: false,
        },
        collection: {
          layout: "list",
          columns: 1,
          summaryFields: [],
          sortBy: "updatedAt",
          sortDirection: "desc",
        },
        theme: {},
      },
      { id: "notes-abc123" },
    );

    expect(template.collection.layout).toBe("list");
    expect(template.theme.surface).toBe("system");
    expect(template.capabilities).not.toContain("publish");
  });

  it("rejects a board without a single-select grouping field", () => {
    expect(() =>
      compileItemTypeBlueprint(
        {
          name: "Broken board",
          fields: [],
          item: { shape: "page" },
          collection: { layout: "board" },
          theme: {},
        },
        { id: "broken-board" },
      ),
    ).toThrow("A board needs a groupBy field");
  });

  it("keeps every ready-made starting point valid and complete", () => {
    expect(ITEM_TYPE_STARTERS.map((starter) => starter.id)).toEqual([
      "editorial-publication",
      "project-board",
      "quick-notes",
    ]);
    for (const starter of ITEM_TYPE_STARTERS) {
      const template = compileItemTypeBlueprint(starter.blueprint, {
        id: `starter-${starter.id}`,
      });
      expect(template.example?.title).toBeTruthy();
      expect(template.collection.item).toBeTruthy();
      expect(template.item).toBeTruthy();
    }
  });
});
