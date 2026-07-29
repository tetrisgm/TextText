// The /templates area renders every built-in look as a real example item.
// One place builds the validated snapshot so the index miniatures and the
// full-page examples can never drift apart.

import { validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { exemplarFor } from "@/lib/presentation/exemplars";
import {
  BUILTIN_TEMPLATES,
  TEMPLATE_CATALOG,
  type TemplateCategory,
} from "@/lib/presentation/templates";
import type { TemplateDefinition } from "@/lib/presentation/schema";

export type TemplateExample = {
  template: TemplateDefinition;
  category: TemplateCategory;
  slug: string;
  document: DocumentSnapshot;
};

export function templateSlug(id: string): string {
  return id.replace(/^texttext\./, "");
}

function exampleDocument(template: TemplateDefinition): DocumentSnapshot {
  const exemplar = exemplarFor(template.id);
  return validateDocumentSnapshot({
    schemaVersion: 1,
    content: {
      title: exemplar?.title ?? template.name,
      body: exemplar?.body ?? "",
      fields: exemplar?.fields ?? {},
      tags: [],
      assets: [],
    },
    presentation: {
      template: { id: template.id, version: template.version },
      theme: {},
    },
  });
}

export function templateExamples(): TemplateExample[] {
  const byId = new Map(BUILTIN_TEMPLATES.map((template) => [template.id, template]));
  return TEMPLATE_CATALOG.map((entry) => {
    const template = byId.get(entry.id);
    if (!template) throw new Error(`catalog names unknown template ${entry.id}`);
    return {
      template,
      category: entry.category,
      slug: templateSlug(entry.id),
      document: exampleDocument(template),
    };
  });
}

export function templateExample(slug: string): TemplateExample | null {
  return templateExamples().find((entry) => entry.slug === slug) ?? null;
}
