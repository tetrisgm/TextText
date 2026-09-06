import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { compileItemTypeBlueprint } from "../item-type-blueprint";
import { validateTemplateDefinition, type TemplateDefinition } from "../schema";
import { assertCompatibleItemTypeFields } from "../item-type-update";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { DocumentRenderer, DocumentCollectionRenderer, formatFieldValue } from "@/components/document/DocumentRenderer";
import { queryCollectionItems } from "../collection-layout";
import { isSafeLinkHref } from "@/lib/content";
import { itemTypeValidationReason } from "@/lib/ai/item-type-generation";

const makeRating = (max?: number) => compileItemTypeBlueprint({
  name: "Ratings", fields: [{ id: "rating", label: "Rating", type: "number", format: "rating", validation: { min: Math.min(0, max ?? 0), max } }],
  collection: { layout: "list", summaryFields: ["rating"] },
}, { id: "ratings" });
const snapshot = (template: TemplateDefinition, title = "Good neighbour") => validateDocumentSnapshot({
  schemaVersion: 1, content: { title, fields: { rating: 4 } },
  presentation: { template: { id: template.id, version: template.version } },
});

describe("bounded rating display and isolated rendering", () => {
  it.each([1e20, 11, 0, -1, 4.5])("compiles unsuitable scale %s as numbers without narrowing storage", (max) => {
    const template = makeRating(max);
    expect(template.fields[0]).toMatchObject({ type: "number", format: "plain", min: Math.min(0, max), max });
    const legacy = { ...template.fields[0], format: "rating" };
    expect(() => assertCompatibleItemTypeFields([legacy] as TemplateDefinition["fields"], template.fields)).not.toThrow();
    expect(() => validateTemplateDefinition({ ...template, fields: [legacy] })).toThrow(/scale from 1 to 10/);
  });
  it.each([undefined, 1, 5, 10])("keeps suitable star scale %s", (max) => {
    const template = makeRating(max);
    expect(template.fields[0]).toMatchObject({ format: "rating" });
    expect(formatFieldValue(4, template.fields[0])).toMatch(/★/);
  });
  it.each([1e20, Infinity, NaN, -1, 0, 2.5])("renders stored scale %s as bounded numeric text", (max) => {
    const definition = { ...makeRating(5).fields[0], type: "number" as const, format: "rating" as const, max };
    expect(formatFieldValue(4, definition)).toBe("4");
  });
  it.each([DocumentRenderer, DocumentCollectionRenderer])("keeps stored huge ratings readable on both surfaces", (Renderer) => {
    const template = makeRating(5);
    Object.assign(template.fields[0], { max: 1e20 });
    const html = renderToStaticMarkup(<Renderer template={template} document={snapshot(template)} />);
    expect(html).toContain("Good neighbour");
    expect(html).not.toContain("could not be displayed");
    expect(html).not.toContain("★");
  });
  it.each([DocumentRenderer, DocumentCollectionRenderer])("contains a child render failure and preserves neighbouring items", (Renderer) => {
    const template = makeRating(5);
    function Broken(): React.ReactNode { throw new Error("private failure details"); }
    const html = renderToStaticMarkup(<>
      <Renderer template={template} document={snapshot(template, "Bad item")} slots={{ bindings: { "content.title": <Broken /> } }} />
      <Renderer template={template} document={snapshot(template)} />
    </>);
    expect(html).toContain("This item could not be displayed.");
    expect(html).toContain("Good neighbour");
    expect(html).not.toContain("private failure details");
    expect(html).not.toContain("Bad item");
  });
});

const cases = [
  { field: { id: "score", label: "Score", type: "number" }, value: "4", expected: /score.*number/ },
  { field: { id: "done", label: "Done", type: "boolean" }, value: "false", expected: /done.*boolean/ },
  { field: { id: "due", label: "Due", type: "date" }, value: 4, expected: /due.*date string/ },
  { field: { id: "title", label: "Title", type: "text" }, value: true, expected: /title.*string/ },
  { field: { id: "status", label: "Status", type: "enum", options: [{ value: "open", label: "Open" }] }, value: "closed", expected: /status.*enum options/ },
];

describe.each([false, true])("filter operand validation with saved view = %s", (saved) => {
  it.each(cases)("rejects the wrong operand for $field.id in blueprints and compiled templates", ({ field, value, expected }) => {
    const filter = { field: field.id, op: "eq", value };
    const collection = saved
      ? { layout: "list", views: [{ id: "filtered", name: "Filtered", layout: "list", filters: [filter] }] }
      : { layout: "list", filters: [filter] };
    expect(() => compileItemTypeBlueprint({ name: "Filtered", fields: [field], collection }, { id: "filtered" })).toThrow(expected);
    const template = compileItemTypeBlueprint({ name: "Filtered", fields: [field], collection: { layout: "list" } }, { id: "filtered" });
    const compiledFilter = { ...filter, field: `content.fields.${field.id}` };
    const compiledCollection = saved
      ? { ...template.collection, views: [{ id: "filtered", name: "Filtered", layout: "list", filters: [compiledFilter] }] }
      : { ...template.collection, filters: [compiledFilter] };
    expect(() => validateTemplateDefinition({ ...template, collection: compiledCollection })).toThrow(expected);
  });
});
it("keeps numeric matching and presence filters working", () => {
  const template = compileItemTypeBlueprint({ name: "Scores", fields: [{ id: "score", label: "Score", type: "number" }], collection: { layout: "list", filters: [{ field: "score", op: "gte", value: 4 }] } }, { id: "scores" });
  expect(queryCollectionItems([{ title: "Five", fields: { score: 5 } }, { title: "Three", fields: { score: 3 } }], template.collection).map(item => item.title)).toEqual(["Five"]);
  for (const op of ["isSet", "notSet"]) {
    expect(() => compileItemTypeBlueprint({ name: "Scores", fields: [{ id: "score", label: "Score", type: "number" }], collection: { layout: "list", filters: [{ field: "score", op }] } }, { id: "scores" })).not.toThrow();
  }
});
it("default ordering handles offsets, invalid dates, creation fallback and pins", () => {
  const items = [
    { title: "Older offset", fields: {}, updatedAt: "2026-09-03T12:00:00+05:00" },
    { title: "Newer UTC", fields: {}, updatedAt: new Date("2026-09-03T10:00:00Z") },
    { title: "Created", fields: {}, createdAt: "2026-09-03T09:00:00Z" },
    { title: "Invalid", fields: {}, updatedAt: "invalid" },
    { title: "Pinned", fields: {}, pinned: true },
  ];
  expect(queryCollectionItems(items, null).map(item => item.title)).toEqual(["Pinned", "Newer UTC", "Created", "Older offset", "Invalid"]);
});
it.each(["\u0000javascript:alert(1)", "\rjavascript:alert(1)", "https://example.com/\npath", "/path\u007f"])("rejects controls before relative URL checks: %j", href => {
  expect(isSafeLinkHref(href)).toBe(false);
});
it.each(["https://example.com", "http://example.com", "mailto:a@example.com", "/path", "#part", "../relative"])("retains explicitly safe links: %s", href => {
  expect(isSafeLinkHref(href)).toBe(true);
});
it("sanitizes validation reasons without exposing JSON, URLs, tokens or controls", () => {
  const message = itemTypeValidationReason(new Error('Bad property <script>hidden</script>\nhttps://example.com/private api-key=private-value sk-test-redacted\u202e'));
  expect(message).not.toMatch(/<script>|https:|private-value|sk-test|\n|\u202e/);
  expect(itemTypeValidationReason(new SyntaxError("private generated JSON"))).not.toContain("private generated JSON");
  expect(itemTypeValidationReason(new Error("x".repeat(1000)))).toHaveLength(600);
});
