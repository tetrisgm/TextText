import { z } from "zod";
import {
  ITEM_TYPE_BLUEPRINT_COMPILER_VERSION,
  itemTypeBlueprintSchema,
  type ItemTypeBlueprint,
} from "@/lib/presentation/item-type-blueprint";

/**
 * How a look was authored, kept beside the look it compiled into.
 *
 * A `TemplateDefinition` is a render tree. The assistant does not write render
 * trees: it writes a blueprint, which compiles into one. Only the output was
 * stored, so the source was destroyed at save and changing a look afterwards
 * meant re-authoring it blind from compiled output. "Make the date bigger on my
 * recipe type" had no path at all.
 *
 * A sibling of the definition, deliberately never a field inside it.
 * `templateDefinitionSchema` is strict and rejects unknown keys, and definitions
 * travel inside sync envelopes and exported bundles that older builds still
 * read. Putting authoring provenance in there would change a format that has
 * already left this machine. This lives in its own column and nothing outside
 * the editor path ever sees it.
 *
 * The compiled definition stays the rendering authority. This is provenance for
 * reopening a look, never a second thing that renders.
 */

export const AUTHORING_SOURCE_SCHEMA_VERSION = 1 as const;

export const authoringSourceSchema = z
  .object({
    /**
     * What kind of source this is. One value today, and the discriminator is
     * here from the start so a look authored some other way - a recorded set of
     * edits, an import that carried its own source - can be stored beside one
     * authored from a blueprint without a migration.
     */
    kind: z.literal("item-type-blueprint"),
    schemaVersion: z.literal(AUTHORING_SOURCE_SCHEMA_VERSION),
    /** Which compiler produced the definition from this blueprint. */
    compilerVersion: z.number().int().positive(),
    /** Normalised, so it is what compiled rather than what arrived. */
    blueprint: itemTypeBlueprintSchema,
  })
  .strict();

export type AuthoringSource = z.infer<typeof authoringSourceSchema>;

export function authoringSourceFor(
  blueprint: ItemTypeBlueprint,
): AuthoringSource {
  return {
    kind: "item-type-blueprint",
    schemaVersion: AUTHORING_SOURCE_SCHEMA_VERSION,
    compilerVersion: ITEM_TYPE_BLUEPRINT_COMPILER_VERSION,
    blueprint,
  };
}

/**
 * Read a stored source back, or answer null.
 *
 * Null is an ordinary answer, not a failure: built-ins are compiled in code and
 * have no row at all, and a look saved from a document, a duplicate, an import
 * and a restored version each carry a definition that was never authored as a
 * blueprint. Every row written before this column existed is null too.
 *
 * A source a later compiler cannot honour also reads as null. That is the point
 * of storing the version: reopening it would compile the same blueprint into a
 * different look, so the honest answer is that this one is edited by hand.
 */
export function readAuthoringSource(value: unknown): AuthoringSource | null {
  if (!value) return null;
  const parsed = authoringSourceSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.compilerVersion !== ITEM_TYPE_BLUEPRINT_COMPILER_VERSION) {
    return null;
  }
  return parsed.data;
}
