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
    expect(BUILTIN_TEMPLATES.map((template) => validateTemplateDefinition(template).id)).toEqual([
      "texttext.article",
      "texttext.note",
      "texttext.bookmark",
      "texttext.gallery",
      "texttext.talk",
    ]);
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

  it("keeps presentation data portable in the document snapshot", () => {
    const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
    expect(document).toEqual({
      schemaVersion: 1,
      content: { title: "", body: "", fields: {}, tags: [], assets: [] },
      presentation: { template: { id: "texttext.note", version: 1 }, theme: {} },
    });
  });
});
