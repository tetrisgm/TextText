import { expect, it } from "vitest";
import { compileItemTypeBlueprint } from "../item-type-blueprint";
import { validateTemplateDefinition } from "../schema";
import { queryCollectionItems } from "../collection-layout";
it.each(["tomorrow", "09/05/2026", "2026-02-30"])("F5: rejects non-ISO or impossible date operand %s", value => {
  const blueprint = { name: "Deadlines", fields: [{ id: "due", label: "Due", type: "date" }], collection: { layout: "list", filters: [{ field: "due", op: "gte", value }] } };
  expect(() => compileItemTypeBlueprint(blueprint, { id: "deadlines" })).toThrow(/date/i);
});
it("F5: compiled templates also reject arbitrary date text rather than an empty valid view", () => {
  const template = compileItemTypeBlueprint({ name: "Deadlines", fields: [{ id: "due", label: "Due", type: "date" }], collection: { layout: "list" } }, { id: "deadlines" });
  const collection = { ...template.collection, filters: [{ field: "content.fields.due", op: "gte", value: "tomorrow" }] };
  // This is the runtime consequence if the invalid filter is accepted.
  expect(queryCollectionItems([{ title: "Future task", fields: { due: "2026-09-06" } }], collection as typeof template.collection)).toEqual([]);
  expect(() => validateTemplateDefinition({ ...template, collection })).toThrow(/date/i);
});
