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
 * Why a stored source cannot be reopened, when it cannot.
 *
 * Four different situations used to collapse into one null: nothing stored,
 * something unreadable, something from a compiler this build cannot honour,
 * and a look that was never designed at all. They need different words. Telling
 * someone their designed look "was assembled rather than designed" because the
 * compiler moved on is not a smaller lie for being convenient.
 */
export type AuthoringSourceState =
  | { state: "authored"; source: AuthoringSource }
  /** Never designed from a blueprint: a built-in, duplicate, import, restore,
   *  a look saved from a document, or a row older than this column. */
  | { state: "assembled" }
  /** Designed, but by a compiler whose output this build would not reproduce.
   *  Reopening it would compile the same blueprint into a different look. */
  | { state: "needs-migration"; compilerVersion: number }
  /** Stored and unreadable. Rare, and worth saying out loud rather than
   *  filing under "was never designed". */
  | { state: "unreadable" };

export function inspectAuthoringSource(value: unknown): AuthoringSourceState {
  if (value === null || value === undefined) return { state: "assembled" };
  const parsed = authoringSourceSchema.safeParse(value);
  if (!parsed.success) {
    // A compiler version this build does not know still parses as a number, so
    // an unreadable envelope is genuinely malformed rather than merely old.
    return { state: "unreadable" };
  }
  if (parsed.data.compilerVersion !== ITEM_TYPE_BLUEPRINT_COMPILER_VERSION) {
    return {
      state: "needs-migration",
      compilerVersion: parsed.data.compilerVersion,
    };
  }
  return { state: "authored", source: parsed.data };
}
