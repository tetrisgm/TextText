import { z } from "zod";

/** Identity-wide library record. Never changes embedded document looks. */
const identifier = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const templateRetirementSchema = z.object({
  format: z.literal("texttext-template-retirement"),
  version: z.literal(1),
  templateId: identifier.refine(value => !value.startsWith("texttext."), "Built-in templates cannot be retired"),
  sourceItemId: z.string().uuid(),
  sourceVersion: z.number().int().positive().safe(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type TemplateRetirement = z.infer<typeof templateRetirementSchema>;

export function parseTemplateRetirement(text: string): TemplateRetirement {
  if (new TextEncoder().encode(text).length > 2048) throw new Error("Template retirement record exceeds limits");
  return templateRetirementSchema.parse(JSON.parse(text));
}

/** Aggregate before selecting versions: a newer or older version cannot revive an ID. */
export function activeTemplateVersions<T extends { templateId: string }>(
  versions: readonly T[], retirements: readonly TemplateRetirement[],
): T[] {
  const retired = new Set(retirements.map(value => templateRetirementSchema.parse(value).templateId));
  return versions.filter(value => !retired.has(value.templateId));
}

export function isTemplateRetirementPath(path: string): boolean {
  return /^Templates\/Retired\/[^/]+\.textpack$/.test(path);
}
