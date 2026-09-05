import { z } from "zod";
import type { DocumentFieldDefinition } from "@/lib/presentation/schema";

/** Explicit destinations are also the review boundary: new usages are never added. */
export const itemTypeSaveScopeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("version") }).strict(),
  z.object({ mode: z.literal("folder"), folderPath: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ mode: z.literal("usages"), folderPaths: z.array(z.string().trim().min(1).max(1000)).max(1000) }).strict(),
]);
export type ItemTypeSaveScope = z.infer<typeof itemTypeSaveScopeSchema>;

/** Enum values ARE the stable option ids in schema v1. Change labels, never
 * infer a value mapping from position or similar wording. Additive edits and
 * label changes preserve stored values without rewriting any snapshot. */
export function assertCompatibleItemTypeFields(
  base: readonly DocumentFieldDefinition[],
  next: readonly DocumentFieldDefinition[],
  parent = "",
): void {
  for (const field of base) {
    const path = parent ? `${parent}.${field.id}` : field.id;
    const successor = next.find((candidate) => candidate.id === field.id);
    const refuse = (reason: string): never => {
      throw new Error(`Field "${path}" (${field.label}) ${reason}. Keep its stored schema and option values, or save a separate item type.`);
    };
    if (!successor) return refuse("cannot be removed or given a different id");
    if (field.type !== successor.type) refuse(`cannot change from ${field.type} to ${successor.type}`);
    if ("multiple" in field && "multiple" in successor && field.multiple !== successor.multiple) {
      // Schema-v1 row cells have always been scalar. Correcting a legacy
      // declaration from multiple to single cannot strand an array value;
      // the document model never accepted one. Top-level fields stay strict.
      if (!(parent && field.multiple && !successor.multiple)) {
        refuse("cannot change between one value and multiple values");
      }
    }
    if (field.type === "reference" && successor.type === "reference" && field.target !== successor.target) {
      refuse("cannot change its reference target");
    }
    if (!field.required && successor.required) refuse("cannot become required for existing items");
    if ("maxLength" in successor && successor.maxLength !== undefined &&
        (!("maxLength" in field) || field.maxLength === undefined || successor.maxLength < field.maxLength)) {
      refuse("cannot reduce its text length limit");
    }
    if (field.type === "number" && successor.type === "number") {
      if ((successor.min !== undefined && (field.min === undefined || successor.min > field.min)) ||
          (successor.max !== undefined && (field.max === undefined || successor.max < field.max)) ||
          (successor.step !== undefined && successor.step !== field.step)) {
        refuse("cannot narrow its accepted numbers");
      }
    }
    if (field.type === "rows" && successor.type === "rows") {
      if (successor.maxRows < field.maxRows) refuse("cannot reduce its row limit");
      assertCompatibleItemTypeFields(field.fields, successor.fields, path);
    }
    if (field.type === "enum" && successor.type === "enum") {
      for (const option of field.options) {
        if (!successor.options.some((candidate) => candidate.value === option.value)) {
          refuse(`cannot remove or rename stored option "${option.value}"; change its label instead`);
        }
        if ((!field.workflow || field.workflow.transitions.some((edge) => edge.from === option.value)) &&
            successor.workflow &&
            !successor.workflow.completed.includes(option.value) &&
            !successor.workflow.transitions.some((edge) => edge.from === option.value)) {
          refuse(`would leave status "${option.value}" without a next step`);
        }
      }
    }
  }
  for (const field of next) {
    if (field.required && !base.some((candidate) => candidate.id === field.id)) {
      const path = parent ? `${parent}.${field.id}` : field.id;
      throw new Error(`Field "${path}" (${field.label}) must be optional when added to an existing item type.`);
    }
  }
}
