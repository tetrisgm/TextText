import { describe, expect, it } from "vitest";
import { compileItemTypeBlueprint, itemTypeBlueprintSchema } from "../item-type-blueprint";
import { inspectAuthoringSource, authoringSourceFor } from "../authoring-source";
import { validateTemplateDefinition } from "../schema";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { itemTypeBlueprintRepairPrompt } from "@/lib/ai/item-type-generation";

function blueprint(type: "enum" | "reference", multiple = true) {
  return itemTypeBlueprintSchema.parse({
    name: "Research", collection: { layout: "list" }, fields: [{ id: "entries", label: "Entries", type: "rows", fields: [{
      id: "tags", label: "Tags", type, multiple,
      ...(type === "enum" ? { options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] } : {}),
    }] }],
  });
}

describe("row authoring matches schema-v1 storage", () => {
  it.each(["enum", "reference"] as const)("rejects multi-valued %s rows with a repairable field path", (type) => {
    const input = blueprint(type);
    let error: unknown;
    try { compileItemTypeBlueprint(input, { id: "research" }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    const repair = itemTypeBlueprintRepairPrompt({ error, generated: JSON.stringify(input), request: "Multiple tags per source" });
    expect(repair).toContain('Row field "entries.tags" cannot use multiple: true');
    expect(repair).toContain("Set multiple to false or omit it");
    expect(repair).toContain("top-level enum or reference field, or one row per value");
    expect(() => compileItemTypeBlueprint(blueprint(type, false), { id: "research" })).not.toThrow();
  });

  it.each(["enum", "reference"] as const)("keeps stored %s definitions and authoring source readable", (type) => {
    expect(inspectAuthoringSource(authoringSourceFor(blueprint(type))).state).toBe("authored");
    const legacy = compileItemTypeBlueprint(blueprint(type, false), { id: "research" });
    const row = legacy.fields.find((field) => field.id === "entries");
    if (row?.type !== "rows" || !("multiple" in row.fields[0])) throw new Error("Expected row relation or enum");
    row.fields[0].multiple = true;
    expect(validateTemplateDefinition(legacy).fields).toEqual(legacy.fields);
  });

  it("preserves the scalar row format and top-level multi-select support", () => {
    const input = blueprint("enum", false);
    const template = compileItemTypeBlueprint({ ...input, fields: [...input.fields, { id: "tags", label: "Tags", type: "enum", multiple: true, options: [{ value: "a", label: "A" }] }] }, { id: "research" });
    expect(template.fields.find((field) => field.id === "tags")).toMatchObject({ multiple: true });
    const document = { schemaVersion: 1, content: { fields: { entries: [{ tags: "a" }], tags: ["a"] } }, presentation: { template: { id: template.id, version: 1 } } };
    expect(() => validateDocumentSnapshot(document)).not.toThrow();
    expect(() => validateDocumentSnapshot({ ...document, content: { fields: { entries: [{ tags: ["a", "b"] }] } } })).toThrow();
  });
});
