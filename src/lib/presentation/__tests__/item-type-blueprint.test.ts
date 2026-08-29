import { describe, expect, it } from "vitest";
import {
  compileItemTypeBlueprint,
  itemTypeBlueprintSchema,
  ITEM_TYPE_STARTERS,
} from "@/lib/presentation/item-type-blueprint";

describe("compileItemTypeBlueprint", () => {
  it("builds a Medium-like publishable blog look for items and the folder", () => {
    const template = compileItemTypeBlueprint(
      {
        name: "Essays",
        description: "Long-form writing with a quiet reading experience.",
        styleReference: "Medium",
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
            display: "auto",
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
  });

  // Was: rejected outright. A throw here sent the model back to repair, and it
  // repaired by deleting the fields as well as the layout, so a request for a
  // board became a type with nothing in it. Degrading is the better failure.
  it("shows a list when a board has nothing to make columns from", () => {
    const template = compileItemTypeBlueprint(
      {
        name: "Broken board",
        fields: [],
        item: { shape: "page" },
        collection: { layout: "board" },
        theme: {},
      },
      { id: "broken-board" },
    );
    expect(template.collection.layout).toBe("list");
  });

  it("keeps every ready-made starting point valid and complete", () => {
    expect(ITEM_TYPE_STARTERS.map((starter) => starter.id)).toEqual([
      "editorial-publication",
      "project-board",
      "quick-notes",
    ]);
    for (const starter of ITEM_TYPE_STARTERS) {
      expect(new Set(starter.blueprint.collection.summaryFields).size).toBe(
        starter.blueprint.collection.summaryFields.length,
      );
      const template = compileItemTypeBlueprint(starter.blueprint, {
        id: `starter-${starter.id}`,
      });
      expect(template.example?.title).toBeTruthy();
      expect(template.collection.item).toBeTruthy();
      expect(template.item).toBeTruthy();
      if (starter.id === "project-board") {
        expect(template.collection.defaultView).toBe("board");
        expect(template.collection.views.map((view) => view.id)).toEqual([
          "board",
          "open",
          "schedule",
        ]);
        expect(template.fields).toContainEqual(
          expect.objectContaining({
            id: "status",
            semantic: "status",
            workflow: expect.objectContaining({
              initial: "not-started",
              completed: ["done"],
            }),
          }),
        );
        expect(template.fields).toContainEqual(
          expect.objectContaining({
            id: "owner",
            type: "reference",
            semantic: "people",
            multiple: true,
          }),
        );
      }
    }
  });

  it("compiles people, relations, recurrence, workflows, constraints, and conditions safely", () => {
    const template = compileItemTypeBlueprint(
      {
        name: "Client work",
        fields: [
          {
            id: "status",
            label: "Status",
            type: "enum",
            options: [
              { value: "planned", label: "Planned" },
              { value: "active", label: "Active" },
              { value: "done", label: "Done" },
            ],
            workflow: {
              initial: "planned",
              completed: ["done"],
              transitions: [
                { from: "planned", to: "active" },
                { from: "active", to: "done" },
              ],
            },
            display: "badge",
          },
          { id: "advanced", label: "Show details", type: "boolean" },
          {
            id: "owner",
            label: "People",
            type: "people",
            multiple: true,
            display: "badge",
          },
          {
            id: "account",
            label: "Account",
            type: "reference",
            target: "document",
          },
          { id: "repeat", label: "Repeats", type: "recurrence" },
          {
            id: "budget",
            label: "Budget",
            type: "number",
            validation: { min: 0, max: 100_000, step: 100 },
          },
          {
            id: "brief",
            label: "Brief",
            type: "text",
            validation: { maxLength: 500 },
            showWhen: "advanced",
          },
        ],
        item: { shape: "page" },
        collection: {
          layout: "list",
          columns: 1,
          summaryFields: ["status", "owner", "repeat"],
          sortBy: "updatedAt",
          sortDirection: "desc",
        },
      },
      { id: "client-work" },
    );

    expect(template.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "status",
          type: "enum",
          semantic: "status",
          workflow: expect.objectContaining({ initial: "planned", completed: ["done"] }),
        }),
        expect.objectContaining({
          id: "owner",
          type: "reference",
          semantic: "people",
          multiple: true,
        }),
        expect.objectContaining({ id: "account", semantic: "relation" }),
        expect.objectContaining({
          id: "repeat",
          type: "enum",
          semantic: "recurrence",
        }),
        expect.objectContaining({ id: "budget", min: 0, max: 100_000, step: 100 }),
        expect.objectContaining({ id: "brief", maxLength: 500 }),
      ]),
    );
    expect(JSON.stringify(template.item)).toContain(
      '"showWhen":"content.fields.advanced"',
    );
  });

  it("compiles read-only rollups and progress without adding stored fields", () => {
    const template = compileItemTypeBlueprint(
      {
        name: "Plan",
        fields: [
          { id: "current", label: "Current", type: "number" },
          { id: "target", label: "Target", type: "number" },
          {
            id: "steps",
            label: "Steps",
            type: "rows",
            display: "checklist",
            fields: [
              { id: "done", label: "Done", type: "boolean" },
              { id: "title", label: "Title", type: "text" },
              { id: "hours", label: "Hours", type: "number" },
            ],
          },
          {
            id: "completion",
            label: "Completion",
            type: "computed",
            display: "progress",
            compute: { op: "doneOf", source: "steps", of: "done" },
          },
          {
            id: "hoursTotal",
            label: "Total hours",
            type: "computed",
            compute: { op: "sum", source: "steps", of: "hours" },
          },
          {
            id: "goalProgress",
            label: "Goal progress",
            type: "computed",
            display: "progress",
            compute: { op: "ratio", current: "current", target: "target" },
          },
        ],
        item: { shape: "task" },
        collection: {
          layout: "list",
          columns: 1,
          summaryFields: ["completion", "hoursTotal"],
          sortBy: "updatedAt",
          sortDirection: "desc",
        },
      },
      { id: "computed-plan" },
    );

    expect(template.fields.map((field) => field.id)).not.toContain("completion");
    expect(template.fields.map((field) => field.id)).not.toContain("hoursTotal");
    expect(template.fields.map((field) => field.id)).not.toContain("goalProgress");
    expect(JSON.stringify(template.item)).toContain(
      '"checklistBind":"content.fields.steps"',
    );
    expect(JSON.stringify(template.item)).toContain('"op":"sum"');
    expect(JSON.stringify(template.item)).toContain(
      '"currentBind":"content.fields.current"',
    );
  });

  it("preserves named folder views with independent filters, grouping, and sort", () => {
    const template = compileItemTypeBlueprint(
      {
        name: "Team tasks",
        fields: [
          {
            id: "status",
            label: "Status",
            type: "enum",
            options: [
              { value: "todo", label: "To do" },
              { value: "doing", label: "Doing" },
              { value: "done", label: "Done" },
            ],
          },
          { id: "due", label: "Due", type: "date" },
          { id: "owner", label: "Owner", type: "people" },
        ],
        item: { shape: "task" },
        collection: {
          layout: "list",
          columns: 1,
          summaryFields: ["status", "due"],
          sortBy: "updatedAt",
          sortDirection: "desc",
          views: [
            {
              id: "board",
              name: "Board",
              layout: "board",
              columns: 3,
              groupBy: "status",
              sort: [{ field: "due", direction: "asc" }],
            },
            {
              id: "due-soon",
              name: "Due soon",
              layout: "calendar",
              dateBy: "due",
              filters: [{ field: "status", op: "neq", value: "done" }],
              sort: [{ field: "due", direction: "asc" }],
            },
          ],
          defaultView: "board",
        },
      },
      { id: "team-tasks" },
    );

    expect(template.collection).toMatchObject({
      layout: "board",
      groupBy: "content.fields.status",
      defaultView: "board",
    });
    expect(template.collection.views).toEqual([
      expect.objectContaining({
        id: "board",
        groupBy: "content.fields.status",
        sort: [{ field: "content.fields.due", direction: "asc" }],
      }),
      expect.objectContaining({
        id: "due-soon",
        dateBy: "content.fields.due",
        filters: [
          { field: "content.fields.status", op: "neq", value: "done" },
        ],
      }),
    ]);
  });

  it("rejects duplicate summaries and invalid computed sources", () => {
    const base = {
      name: "Broken",
      fields: [{ id: "title", label: "Title", type: "text" as const }],
      item: { shape: "page" as const },
      collection: {
        layout: "list" as const,
        summaryFields: ["title", "title"],
        sortBy: "updatedAt" as const,
      },
    };
    expect(() => compileItemTypeBlueprint(base, { id: "broken-summary" })).toThrow(
      "Summary fields must be unique",
    );
    expect(() =>
      compileItemTypeBlueprint(
        {
          ...base,
          fields: [
            ...base.fields,
            {
              id: "total",
              label: "Total",
              type: "computed",
              compute: { op: "count", source: "title" },
            },
          ],
          collection: { ...base.collection, summaryFields: ["total"] },
        },
        { id: "broken-computed" },
      ),
    ).toThrow("needs a rows source");
  });
});

describe("display values that only apply to one field type", () => {
  const base = {
    name: "Guarded",
    item: { shape: "page" as const },
    collection: { layout: "list" as const },
    theme: {},
  };

  /**
   * The compiler honours `cover` only for images and `toggle` only for
   * booleans, and silently ignored them everywhere else. A model asking for a
   * cover on a text field got a plain fact and no explanation, which is the
   * one outcome it cannot learn from.
   */
  it("refuses a cover on anything but an image, and says which field", () => {
    expect(() =>
      itemTypeBlueprintSchema.parse({
        ...base,
        fields: [{ id: "headline", label: "Headline", type: "text", display: "cover" }],
      }),
    ).toThrow(/cover.*image.*headline.*text/s);
  });

  it("refuses a toggle on anything but a boolean", () => {
    expect(() =>
      itemTypeBlueprintSchema.parse({
        ...base,
        fields: [{ id: "status", label: "Status", type: "date", display: "toggle" }],
      }),
    ).toThrow(/toggle.*boolean.*status.*date/s);
  });

  it("still accepts each on the type it was made for", () => {
    expect(() =>
      itemTypeBlueprintSchema.parse({
        ...base,
        fields: [
          { id: "hero", label: "Hero", type: "image", display: "cover" },
          { id: "done", label: "Done", type: "boolean", display: "toggle" },
        ],
      }),
    ).not.toThrow();
  });

  it("refuses a section on anything but text or richtext", () => {
    // It compiled into a prose node and the render validator then threw
    // "prose cannot consume number binding ...", naming a node the model never
    // wrote and cannot see. The schema said yes and the compiler said no.
    expect(() =>
      itemTypeBlueprintSchema.parse({
        ...base,
        fields: [{ id: "cookTime", label: "Cook time", type: "number", display: "section" }],
      }),
    ).toThrow(/section.*text or richtext.*cookTime.*number/s);
  });

  it("still accepts a section on the two types that render one", () => {
    expect(() =>
      itemTypeBlueprintSchema.parse({
        ...base,
        fields: [
          { id: "notes", label: "Notes", type: "richtext", display: "section" },
          { id: "intro", label: "Intro", type: "text", display: "section" },
        ],
      }),
    ).not.toThrow();
  });

  it("leaves the display values that work across types alone", () => {
    // Only cover and toggle are constrained, because only they are strictly
    // bound to one field type in the compiler. The rest are left alone here;
    // whether every one of them is honoured for every type is a separate
    // question this does not claim to answer.
    for (const display of ["badge", "section", "hidden", "auto"] as const) {
      expect(() =>
        itemTypeBlueprintSchema.parse({
          ...base,
          fields: [{ id: "note", label: "Note", type: "text", display }],
        }),
      ).not.toThrow();
    }
  });
});

describe("the metadata line appears once", () => {
  /**
   * A note with showMetadata emitted two: the header pushes one for every
   * shape that is not an article, and a second was pushed just before the
   * header for notes specifically. Found by adversarial review; no test
   * counted nodes, so two identical lines rendered and nothing complained.
   */
  function metaNodes(node: unknown): number {
    if (!node || typeof node !== "object") return 0;
    const n = node as { type?: string; children?: unknown[] };
    let count = ["metadata", "byline", "meta"].includes(n.type ?? "") ? 1 : 0;
    for (const child of n.children ?? []) count += metaNodes(child);
    return count;
  }

  it.each(["note", "article", "page", "task", "reference"] as const)(
    "emits exactly one for a %s that asks for it",
    (shape) => {
      const template = compileItemTypeBlueprint(
        {
          name: "Once",
          fields: [],
          item: { shape, showMetadata: true },
          collection: { layout: "list" },
          theme: {},
        },
        { id: "custom.once" },
      );
      expect(metaNodes(template.item)).toBe(1);
    },
  );

  it.each(["note", "article", "page", "task", "reference"] as const)(
    "emits none for a %s that does not ask",
    (shape) => {
      const template = compileItemTypeBlueprint(
        {
          name: "None",
          fields: [],
          item: { shape, showMetadata: false },
          collection: { layout: "list" },
          theme: {},
        },
        { id: "custom.none" },
      );
      expect(metaNodes(template.item)).toBe(0);
    },
  );
});
