// The /templates area renders every built-in look as a real example item.
// One place builds the validated snapshot so the index miniatures and the
// full-page examples can never drift apart.

import { validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { GENERATED_BUILTIN_PRESETS } from "@/lib/presentation/generated-builtin-presets";
import {
  TEMPLATE_CATALOG,
  type TemplateCategory,
} from "@/lib/presentation/templates";
import type { TemplateDefinition } from "@/lib/presentation/schema";

type TemplateExample = {
  template: TemplateDefinition;
  category: TemplateCategory;
  slug: string;
  document: DocumentSnapshot;
};

export function templateSlug(id: string): string {
  return id.replace(/^texttext\./, "");
}

export function templateExamples(): TemplateExample[] {
  const byId = new Map(
    GENERATED_BUILTIN_PRESETS.map((preset) => [preset.template.id, preset]),
  );
  return TEMPLATE_CATALOG.map((entry) => {
    const preset = byId.get(entry.id);
    if (!preset)
      throw new Error(`catalog names unknown template ${entry.id}`);
    const document = validateDocumentSnapshot(preset.document);
    if (
      document.presentation.template.id !== preset.template.id ||
      document.presentation.template.version !== preset.template.version
    ) {
      throw new Error(`example has wrong template reference ${entry.id}`);
    }
    return {
      template: preset.template,
      category: entry.category,
      slug: templateSlug(entry.id),
      document,
    };
  });
}

export function templateExample(slug: string): TemplateExample | null {
  return templateExamples().find((entry) => entry.slug === slug) ?? null;
}
