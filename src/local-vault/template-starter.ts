import type { DocumentSnapshot } from "@/lib/documents/model";
import type { TemplateDefinition } from "@/lib/presentation/schema";

/** Creation only. Examples preview a look; only an explicit starter seeds writing. */
export function templateStarterDocument(source: DocumentSnapshot, template: TemplateDefinition): DocumentSnapshot {
  return { ...source, content: { ...source.content, title: template.starter?.title ?? "", subtitle: "",
    body: template.starter?.body ?? "", fields: { ...template.starter?.fields }, tags: [], assets: [] },
    presentation: { ...source.presentation, template: { id: template.id, version: template.version } } };
}
