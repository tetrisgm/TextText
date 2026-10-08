import { validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { validateTemplateDefinition, type TemplateDefinition } from "@/lib/presentation/schema";
import { authoringSourceSchema } from "@/lib/presentation/authoring-source";
import { compileItemTypeBlueprint } from "@/lib/presentation/item-type-blueprint";
import { templateExperience } from "@/lib/presentation/templates";

/** Human and agent library creation must prepare matching metadata before the
 * transport publishes the cloned package. Source content is never renamed. */
export function prepareSavedLook(document: DocumentSnapshot, original: TemplateDefinition, name: string, authoringSourceJSON?: string | null) {
  if (!name.trim() || name.length > 160) throw new Error("Choose a template name of 1 to 160 characters.");
  const identity = { id: `local.${crypto.randomUUID()}`, version: 1 };
  let template = validateTemplateDefinition({ ...original, ...identity, name, experience: templateExperience(original) ?? undefined });
  let sourceJSON: string | null = null;
  if (authoringSourceJSON) {
    const source = authoringSourceSchema.parse(JSON.parse(authoringSourceJSON));
    source.blueprint.name = name;
    template = validateTemplateDefinition({ ...compileItemTypeBlueprint(source.blueprint, identity), experience: templateExperience(original) ?? undefined });
    sourceJSON = JSON.stringify(source);
  }
  const snapshot = validateDocumentSnapshot({ ...document, presentation: { ...document.presentation, template: identity } });
  return { documentJSON: JSON.stringify(snapshot), templateJSON: JSON.stringify(template), templateAuthoringSourceJSON: sourceJSON };
}
