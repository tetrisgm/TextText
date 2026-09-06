import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { compileItemTypeBlueprint, itemTypeBlueprintSchema } from "../item-type-blueprint";
import { validateTemplateDefinition } from "../schema";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { ItemTypeCollectionPreview, collectionPreviewItem } from "@/components/workspace/ItemTypeCollectionPreview";

// Deterministic representative model outputs, not claims about live AI output.
const scenarios = [
 { name: "Reading list", fields: [{ id: "rating", label: "Rating", type: "number", format: "rating", validation: { min: 0, max: 5 } }, { id: "readOn", label: "Read on", type: "date" }], collection: { layout: "list", summaryFields: ["rating", "readOn"], sortBy: "rating", sortDirection: "desc" }, values: { rating: 4, readOn: "2026-09-03" }, expected: ["★★★★☆", "Sep 3, 2026"] },
 { name: "Recipes", fields: [{ id: "cookTime", label: "Cook time", type: "number", format: "minutes" }, { id: "ingredients", label: "Ingredients", type: "rows", display: "table", fields: [{ id: "ingredient", label: "Ingredient", type: "text" }, { id: "quantity", label: "Quantity", type: "number" }] }], collection: { layout: "cards", summaryFields: ["cookTime"] }, values: { cookTime: 80, ingredients: [{ ingredient: "Flour", quantity: 250 }] }, expected: ["1 h 20 m", "Flour", "250"] },
 { name: "Travel log", fields: [{ id: "map", label: "Map link", type: "url" }, { id: "visited", label: "Visited", type: "date" }], collection: { layout: "list", views: [{ id: "calendar", name: "Calendar", layout: "calendar", dateBy: "visited" }], defaultView: "calendar" }, values: { map: "https://maps.example.com/place", visited: "2028-02-29" }, expected: ['href="https://maps.example.com/place"', "Feb 29, 2028"] },
];
it.each(scenarios)("compiles and renders representative $name output", ({ values, expected, ...source }) => {
 const template = compileItemTypeBlueprint(source, { id: "qa.prompt" });
 const document = validateDocumentSnapshot({ schemaVersion: 1, content: { title: source.name, fields: values }, presentation: { template: { id: template.id, version: 1 } } });
 const html = renderToStaticMarkup(<DocumentRenderer template={template} document={document} preview />);
 for (const text of expected) expect(html).toContain(text);
 const folder = renderToStaticMarkup(<ItemTypeCollectionPreview template={template} items={[collectionPreviewItem(document)]} label="QA" />);
 expect(folder).toContain(source.name);
 if (source.name === "Travel log") expect(folder).toContain("February 2028");
});
it("strict schemas reject executable keys and CSS injection", () => {
 const blueprint = itemTypeBlueprintSchema.parse({ name: "Safe", collection: { layout: "list" } });
 expect(() => itemTypeBlueprintSchema.parse({ ...blueprint, component: "script" })).toThrow();
 expect(() => itemTypeBlueprintSchema.parse({ ...blueprint, theme: { accent: "red; background:url(https://example.com)" } })).toThrow();
 const template = compileItemTypeBlueprint(blueprint, { id: "safe" });
 expect(() => validateTemplateDefinition({ ...template, item: { type: "script", children: [] } })).toThrow();
 expect(() => validateTemplateDefinition({ ...template, item: { type: "text", bind: "content.title", dangerouslySetInnerHTML: { __html: "<script>" } } })).toThrow();
});
it("renders untrusted text literally and never emits a control-character URL", () => {
 const template = compileItemTypeBlueprint({ name: "Travel", fields: [{ id: "map", label: "Map", type: "url" }], collection: { layout: "list" } }, { id: "safe" });
 const document = validateDocumentSnapshot({ schemaVersion: 1, content: { title: '<script>alert(1)</script>', fields: { map: 'java\nscript:alert(1)' } }, presentation: { template: { id: template.id, version: 1 } } });
 const html = renderToStaticMarkup(<DocumentRenderer template={template} document={document} preview />);
 expect(html).not.toContain('<script>');
 expect(html).toContain('&lt;script&gt;');
 // The allowlist now rejects the control-character scheme before render, so no link and nothing for React to block.
 expect(html).not.toContain('javascript:');
 expect(html).not.toContain('React has blocked');
 expect(html).not.toMatch(/href="java/);
});
it("rejects a string operand on a numeric filter at compile time, naming the property", () => {
 expect(() => compileItemTypeBlueprint({ name: "Books", fields: [{ id: "rating", label: "Rating", type: "number" }], collection: { layout: "list", filters: [{ field: "rating", op: "gte", value: "4" }] } }, { id: "books" })).toThrow(/rating/);
});
