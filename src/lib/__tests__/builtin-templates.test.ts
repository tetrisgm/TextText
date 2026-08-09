import { describe, expect, it } from "vitest";

import { exemplarFor } from "@/lib/presentation/exemplars";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import {
  BUILTIN_TEMPLATES,
  TEMPLATE_CATALOG,
  TEMPLATE_CATEGORIES,
  getBuiltinTemplate,
  requireBuiltinTemplate,
} from "@/lib/presentation/templates";

const ORIGINAL_FIVE = [
  "texttext.article",
  "texttext.note",
  "texttext.bookmark",
  "texttext.gallery",
  "texttext.talk",
] as const;

describe("built-in templates", () => {
  it("every built-in passes validateTemplateDefinition", () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(
        () => validateTemplateDefinition(template),
        template.id,
      ).not.toThrow();
    }
  });

  it("template ids and id@version keys are unique", () => {
    const ids = BUILTIN_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = BUILTIN_TEMPLATES.map(
      (template) => `${template.id}@${template.version}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the original five built-ins resolvable at version 1", () => {
    for (const id of ORIGINAL_FIVE) {
      const template = requireBuiltinTemplate(id, 1);
      expect(template.id).toBe(id);
      expect(template.version).toBe(1);
    }
  });

  it("offers only the focused catalog at version 1", () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(9);
    expect(BUILTIN_TEMPLATES.map((template) => template.name)).toEqual([
      "Article",
      "Note",
      "Bookmark",
      "Gallery",
      "Talk",
      "Case study",
      "Page",
      "Tasks",
      "Project",
    ]);
    // A look is named for the document it makes, never for another product.
    const borrowed =
      /medium|apple|instapaper|pinterest|youtube|notion|substack|figma/i;
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.name).not.toMatch(borrowed);
      expect(template.description ?? "").not.toMatch(borrowed);
    }
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.version).toBe(1);
      expect(template.id.startsWith("texttext.")).toBe(true);
    }
  });

  it("keeps retired templates resolvable without offering them in the gallery", () => {
    expect(requireBuiltinTemplate("texttext.meeting", 1).name).toBe(
      "Meeting notes",
    );
    expect(
      BUILTIN_TEMPLATES.some((template) => template.id === "texttext.meeting"),
    ).toBe(false);
    expect(
      TEMPLATE_CATALOG.some((entry) => entry.id === "texttext.meeting"),
    ).toBe(false);
  });

  it("keeps media in the gallery exemplar", () => {
    const exemplar = exemplarFor("texttext.gallery");

    expect(exemplar?.assets).toHaveLength(4);
    expect(exemplar?.assets?.every((asset) => asset.kind === "image")).toBe(
      true,
    );
    // Alt text describes the file, so every asset must carry a real one.
    expect(
      exemplar?.assets?.every((asset) => (asset.alt ?? "").length > 12),
    ).toBe(true);
  });

  it("catalogs every template exactly once with a known category", () => {
    const categories = new Set<string>(TEMPLATE_CATEGORIES);
    expect(TEMPLATE_CATALOG.length).toBe(BUILTIN_TEMPLATES.length);
    const catalogIds = new Set(TEMPLATE_CATALOG.map((entry) => entry.id));
    expect(catalogIds.size).toBe(TEMPLATE_CATALOG.length);
    for (const entry of TEMPLATE_CATALOG) {
      expect(categories.has(entry.category), entry.id).toBe(true);
      expect(getBuiltinTemplate(entry.id), entry.id).not.toBeNull();
    }
    for (const template of BUILTIN_TEMPLATES) {
      expect(catalogIds.has(template.id), template.id).toBe(true);
    }
  });

  it("keeps descriptions to clean single sentences without em dashes", () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description, template.id).toBeTruthy();
      expect(template.description, template.id).not.toMatch(/\u2014/);
      expect(template.name, template.id).not.toMatch(/\u2014/);
    }
  });

  it("returns null for unknown ids and versions", () => {
    expect(getBuiltinTemplate("texttext.unknown")).toBeNull();
    expect(getBuiltinTemplate("texttext.article", 2)).toBeNull();
    expect(() => requireBuiltinTemplate("texttext.unknown")).toThrow();
  });
});
