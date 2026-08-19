import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import {
  validateTemplateDefinition,
} from "@/lib/presentation/schema";
import { BUILTIN_TEMPLATES, requireBuiltinTemplate } from "@/lib/presentation/templates";

describe("closed presentation contract", () => {
  it("validates every built-in through the same schema", () => {
    const ids = BUILTIN_TEMPLATES.map(
      (template) => validateTemplateDefinition(template).id,
    );
    // The original five stay first and byte-compatible; the expanded catalog
    // (exact membership covered by builtin-templates.test.ts) follows them.
    expect(ids.slice(0, 5)).toEqual([
      "texttext.article",
      "texttext.note",
      "texttext.bookmark",
      "texttext.gallery",
      "texttext.talk",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects free CSS and undeclared fields", () => {
    const article = requireBuiltinTemplate("texttext.article");
    expect(() => validateTemplateDefinition({ ...article, css: ".tt-text{color:red}" })).toThrow();
    expect(() => validateTemplateDefinition({
      ...article,
      item: { type: "text", bind: "content.fields.secret", role: "body" },
    })).toThrow(/undeclared field/);
  });

  it("rejects a field consumed by an incompatible primitive", () => {
    const article = requireBuiltinTemplate("texttext.article");
    expect(() => validateTemplateDefinition({
      ...article,
      fields: [{ id: "rating", label: "Rating", type: "number" }],
      item: { type: "image", bind: "content.fields.rating" },
    })).toThrow(/cannot consume number/);
  });

  it("validates a look derived from a template plus a theme", () => {
    // How "Save as look" makes one: the template a document renders with, plus
    // the theme that document carries. The operations vocabulary that used to
    // build these was removed 2026-08-15; the validator is still the gate.
    const article = requireBuiltinTemplate("texttext.article");
    const derived = validateTemplateDefinition({
      ...article,
      id: "field-notes",
      version: 1,
      name: "Field notes",
      theme: { ...article.theme, typography: "mono", measure: "wide" },
    });
    expect(derived.name).toBe("Field notes");
    expect(derived.theme.typography).toBe("mono");
    expect(derived.theme.measure).toBe("wide");
    // The reserved prefix stays reserved.
    expect(() =>
      validateTemplateDefinition({ ...derived, id: "texttext.mine" }),
    ).not.toThrow();
  });

  it("accepts board grouping on a single-select enum and rejects anything else", () => {
    const project = requireBuiltinTemplate("texttext.project");
    expect(project.collection.layout).toBe("board");
    expect(project.collection.groupBy).toBe("content.fields.status");
    // groupBy must survive validation only when it names a declared
    // single-select enum; a text field is rejected loudly.
    const broken = structuredClone(project) as { collection: { groupBy?: string } };
    broken.collection.groupBy = "content.fields.lead";
    expect(() => validateTemplateDefinition(broken)).toThrow(/single-select enum/);
    broken.collection.groupBy = "content.fields.nonexistent";
    expect(() => validateTemplateDefinition(broken)).toThrow(/undeclared/);
  });

  it("accepts calendar placement on a date field and rejects anything else", () => {
    const calendar = requireBuiltinTemplate("texttext.calendar");
    expect(calendar.collection.layout).toBe("calendar");
    expect(calendar.collection.dateBy).toBe("content.fields.publishDate");
    const broken = structuredClone(calendar) as { collection: { dateBy?: string } };
    broken.collection.dateBy = "content.fields.author";
    expect(() => validateTemplateDefinition(broken)).toThrow(/date field/);
    broken.collection.dateBy = "content.fields.nonexistent";
    expect(() => validateTemplateDefinition(broken)).toThrow(/undeclared/);
  });

  it("validates named collection views against declared fields", () => {
    const project = requireBuiltinTemplate("texttext.project");
    const withViews = validateTemplateDefinition({
      ...project,
      collection: {
        ...project.collection,
        views: [
          {
            id: "open-board",
            name: "Open board",
            layout: "board",
            columns: 3,
            groupBy: "content.fields.status",
            filters: [
              { field: "content.fields.status", op: "neq", value: "done" },
            ],
            sort: [{ field: "updatedAt", direction: "desc" }],
          },
        ],
        defaultView: "open-board",
      },
    });
    expect(withViews.collection.views[0]).toMatchObject({
      id: "open-board",
      groupBy: "content.fields.status",
    });

    const invalid = structuredClone(withViews);
    invalid.collection.views[0]!.groupBy = "content.fields.lead";
    expect(() => validateTemplateDefinition(invalid)).toThrow(/single-select enum/);
    invalid.collection.views[0]!.groupBy = "content.fields.missing";
    expect(() => validateTemplateDefinition(invalid)).toThrow(/undeclared/);
  });

  it("validates status workflows and recurrence semantics", () => {
    const project = requireBuiltinTemplate("texttext.project");
    const status = project.fields.find((field) => field.id === "status");
    expect(status?.type).toBe("enum");
    const valid = validateTemplateDefinition({
      ...project,
      fields: project.fields.map((field) =>
        field.id === "status"
          ? {
              ...field,
              semantic: "status",
              workflow: {
                initial: "planned",
                completed: ["done"],
                transitions: [{ from: "planned", to: "active" }],
              },
            }
          : field,
      ),
    });
    expect(valid.fields.find((field) => field.id === "status")).toMatchObject({
      semantic: "status",
      workflow: { initial: "planned", completed: ["done"] },
    });

    const broken = structuredClone(valid);
    const brokenStatus = broken.fields.find((field) => field.id === "status");
    if (brokenStatus?.type === "enum" && brokenStatus.workflow) {
      brokenStatus.workflow.initial = "missing";
    }
    expect(() => validateTemplateDefinition(broken)).toThrow(/unknown option/);
  });

  it("derived facts validate their rows field and sub-field types", () => {
    const recipe = requireBuiltinTemplate("texttext.recipe");
    const broken = structuredClone(recipe) as {
      item: { children: { children?: unknown[] }[] };
    };
    // Reroute the derived entry to a text sub-field; validation must refuse.
    const masthead = broken.item.children.find(
      (child) => (child as { type?: string }).type === "masthead",
    ) as { children: { type?: string; entries?: { derive?: { of?: string } }[] }[] };
    const facts = masthead.children.find((child) => child.type === "facts")!;
    const derived = facts.entries!.find((entry) => entry.derive)!;
    derived.derive!.of = "row.instruction";
    expect(() => validateTemplateDefinition(broken)).toThrow(/facts sum of/);
  });

  it("keeps presentation data portable in the document snapshot", () => {
    const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
    expect(document).toEqual({
      schemaVersion: 1,
      content: { title: "", body: "", fields: {}, tags: [], assets: [] },
      presentation: { template: { id: "texttext.note", version: 1 }, theme: {} },
    });
  });
});
