import { authoringSourceFor } from "../authoring-source";
import { compileItemTypeBlueprint, itemTypeBlueprintSchema } from "../item-type-blueprint";
import { describe, expect, it } from "vitest";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import {
  filterTemplateLibrary,
  parseTemplateLook,
  parseTemplateLookBundle,
  safeTemplateFilename,
  serializeTemplateLook,
  type TemplateLibraryEntry,
} from "@/lib/presentation/template-library";

function entry(
  id: "texttext.article" | "texttext.todo",
  scope: TemplateLibraryEntry["scope"],
): TemplateLibraryEntry {
  const definition = requireBuiltinTemplate(id, 1);
  return {
    definition,
    scope,
    createdAt: null,
    versions: [{ definition, createdAt: null }],
    impact: { itemCount: 0, folderCount: 0, folderNames: [] },
  };
}

describe("template library", () => {
  it("searches names, descriptions, layouts, typography, and field labels", () => {
    const entries = [
      entry("texttext.article", "personal"),
      entry("texttext.todo", "workspace"),
    ];
    expect(filterTemplateLibrary(entries, "article", "all")).toHaveLength(1);
    expect(filterTemplateLibrary(entries, "area", "all")).toHaveLength(1);
    expect(filterTemplateLibrary(entries, "", "workspace")[0]?.scope).toBe(
      "workspace",
    );
  });

  it("round trips a validated look export", () => {
    const template = requireBuiltinTemplate("texttext.article", 1);
    expect(parseTemplateLook(serializeTemplateLook(template))).toEqual(template);
  });

  it("rejects malformed and oversized imports without interpreting markup", () => {
    expect(() => parseTemplateLook("not json")).toThrow("not valid JSON");
    expect(() => parseTemplateLook(JSON.stringify({ format: "wrong" }))).toThrow(
      "invalid or unsupported",
    );
    expect(() => parseTemplateLook(" ".repeat(1_000_001))).toThrow("larger than 1 MB");
  });

  it("creates portable, predictable filenames", () => {
    expect(safeTemplateFilename("My Editorial Look")).toBe(
      "my-editorial-look.texttext-look.json",
    );
  });
});

describe("portable editable look source", () => {
  const blueprint = itemTypeBlueprintSchema.parse({ name: "Review", fields: [], collection: { layout: "list" }, starter: { title: "My review", body: "## Summary", fields: {} } });
  const template = compileItemTypeBlueprint(blueprint, { id: "review", version: 3 });
  const source = authoringSourceFor(blueprint);
  it("round trips the exact design and starter content beside the render definition", () => {
    const bundle = parseTemplateLookBundle(serializeTemplateLook(template, source));
    expect(bundle.template).toEqual(template);
    expect(bundle.authoringSource).toEqual(source);
    expect(compileItemTypeBlueprint(bundle.authoringSource!.blueprint, { id: "imported-review", version: 1 })).toEqual({ ...template, id: "imported-review", version: 1 });
  });
  it("keeps legacy definition-only files readable", () => {
    expect(parseTemplateLookBundle(serializeTemplateLook(template)).authoringSource).toBeUndefined();
    expect(parseTemplateLook(JSON.stringify(template))).toEqual(template);
  });
  it("rejects a source that would silently alter appearance or defaults", () => {
    expect(() => serializeTemplateLook(template, { ...source, blueprint: { ...blueprint, name: "Different" } })).toThrow("does not match");
    const file = JSON.parse(serializeTemplateLook(template, source));
    file.authoringSource.blueprint.starter.title = "Changed";
    expect(() => parseTemplateLookBundle(JSON.stringify(file))).toThrow("invalid or unsupported");
    file.authoringSource.compilerVersion += 1;
    expect(() => parseTemplateLookBundle(JSON.stringify(file))).toThrow("invalid or unsupported");
  });
});
