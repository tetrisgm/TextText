import { describe, expect, it } from "vitest";

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
      expect(() => validateTemplateDefinition(template), template.id).not.toThrow();
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

  it("ships the expanded catalog as new ids at version 1", () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(22);
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.version).toBe(1);
      expect(template.id.startsWith("texttext.")).toBe(true);
    }
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
