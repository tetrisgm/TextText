import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { prepareSavedLook } from "./saved-look";
import { compileItemTypeBlueprint, ITEM_TYPE_BLUEPRINT_COMPILER_VERSION } from "@/lib/presentation/item-type-blueprint";

describe("shared saved-look preparation", () => {
  it("preserves source content and theme while making an independent library identity", () => {
    const original = BUILTIN_TEMPLATES.find(template => template.id === "texttext.note")!;
    const document = emptyDocumentSnapshot({ id: original.id, version: original.version });
    document.content.title = "Saved item title";
    document.content.body = "Human and agent edits stay here.";
    document.content.fields = { custom: "Keep" };
    const before = structuredClone(document);
    const first = prepareSavedLook(document, original, "Reusable note");
    const second = prepareSavedLook(document, original, "Reusable note");
    const saved = JSON.parse(first.documentJSON), template = JSON.parse(first.templateJSON);
    expect(saved.content).toEqual(before.content);
    expect(saved.presentation.theme).toEqual(before.presentation.theme);
    expect(saved.presentation.template).toEqual({ id: template.id, version: 1 });
    expect(template.id).not.toBe(original.id);
    expect(template.id).not.toBe(JSON.parse(second.templateJSON).id);
    expect(template.name).toBe("Reusable note");
    expect(document).toEqual(before);
    expect(first.templateAuthoringSourceJSON).toBeNull();
  });

  it("retains editable blueprint provenance with the new name and matching identity", () => {
    const blueprint = { name: "Original research", fields: [], collection: { layout: "list" as const } };
    const template = compileItemTypeBlueprint(blueprint, { id: "local.source", version: 3 });
    const document = emptyDocumentSnapshot({ id: template.id, version: template.version });
    document.content.title = "Source item";
    const source = JSON.stringify({ kind: "item-type-blueprint", schemaVersion: 1, compilerVersion: ITEM_TYPE_BLUEPRINT_COMPILER_VERSION, blueprint });
    const saved = prepareSavedLook(document, template, "Reusable research", source);
    const definition = JSON.parse(saved.templateJSON), provenance = JSON.parse(saved.templateAuthoringSourceJSON!);
    expect(provenance.blueprint.name).toBe("Reusable research");
    expect(definition).toEqual(compileItemTypeBlueprint(provenance.blueprint, { id: definition.id, version: 1 }));
    expect(JSON.parse(saved.documentJSON).content.title).toBe("Source item");
    expect(blueprint.name).toBe("Original research");
  });

  it("rejects invalid names and malformed snapshots before creation", () => {
    const template = BUILTIN_TEMPLATES.find(template => template.id === "texttext.note")!;
    const document = emptyDocumentSnapshot({ id: template.id, version: template.version });
    for (const name of ["", "   ", "a".repeat(161)]) expect(() => prepareSavedLook(document, template, name)).toThrow();
    expect(() => prepareSavedLook({...document, schemaVersion: 42} as never, template, "Valid")).toThrow();
    expect(() => prepareSavedLook(document, template, "Valid", "{broken")).toThrow();
  });
});
