import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import {
  applyTemplateOperations,
  type TemplateOperation,
} from "@/lib/presentation/operations";
import {
  validateTemplateDefinition,
  type TemplateDefinition,
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

  it("applies only bounded operations and revalidates each result", () => {
    const article = requireBuiltinTemplate("texttext.article");
    const operations: TemplateOperation[] = [
      { op: "set-name", name: "Field notes" },
      { op: "set-theme", theme: { typography: "mono", measure: "wide" } },
      { op: "set-collection-layout", layout: "list", columns: 1 },
    ];
    const next = applyTemplateOperations(article, operations);
    expect(next.name).toBe("Field notes");
    expect(next.theme).toEqual({ typography: "mono", measure: "wide" });
    expect(next.collection).toMatchObject({ layout: "list", columns: 1 });
    expect(() => applyTemplateOperations(article, [
      {
        op: "replace-item",
        item: { type: "video", bind: "content.fields.cover" },
      },
    ])).not.toThrow();
  });

  it("accepts board grouping on a single-select enum and rejects anything else", () => {
    const project = requireBuiltinTemplate("texttext.project");
    expect(project.collection.layout).toBe("board");
    expect(project.collection.groupBy).toBe("content.fields.status");
    const grouped = applyTemplateOperations(project, [
      { op: "set-collection-sort", sort: [{ field: "updatedAt", direction: "desc" }] },
    ]);
    expect(grouped.collection.groupBy).toBe("content.fields.status");
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

  it("keeps presentation data portable in the document snapshot", () => {
    const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
    expect(document).toEqual({
      schemaVersion: 1,
      content: { title: "", body: "", fields: {}, tags: [], assets: [] },
      presentation: { template: { id: "texttext.note", version: 1 }, theme: {} },
    });
  });
});
