import { describe, expect, it } from "vitest";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import {
  filterTemplateLibrary,
  parseTemplateLook,
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
