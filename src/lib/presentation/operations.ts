import { z } from "zod";
import type {
  DocumentFieldDefinition,
  RenderNode,
  TemplateDefinition,
} from "@/lib/presentation/schema";
import {
  CAPABILITIES,
  collectionRenderSchema,
  documentFieldDefinitionSchema,
  renderNodeSchema,
  themeTokensSchema,
  validateTemplateDefinition,
} from "@/lib/presentation/schema";

export const templateOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set-name"),
    name: z.string().trim().min(1).max(160),
  }).strict(),
  z.object({
    op: z.literal("set-description"),
    description: z.string().trim().max(1_000),
  }).strict(),
  z.object({
    op: z.literal("set-capabilities"),
    capabilities: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length),
  }).strict(),
  z.object({
    op: z.literal("set-fields"),
    fields: z.array(documentFieldDefinitionSchema).max(80),
  }).strict(),
  z.object({ op: z.literal("set-theme"), theme: themeTokensSchema }).strict(),
  z.object({ op: z.literal("replace-item"), item: renderNodeSchema }).strict(),
  z.object({
    op: z.literal("replace-collection-item"),
    item: renderNodeSchema,
  }).strict(),
  z.object({
    op: z.literal("set-collection-layout"),
    layout: collectionRenderSchema.shape.layout,
    columns: collectionRenderSchema.shape.columns.optional(),
  }).strict(),
  // Sort and filters are what turn declared fields into an organized
  // collection: "Books by rating, unread first" is exactly one of each.
  // Referenced fields are validated against the declared field list by
  // validateTemplateDefinition when the operation result is rebuilt.
  z.object({
    op: z.literal("set-collection-sort"),
    sort: collectionRenderSchema.shape.sort,
  }).strict(),
  z.object({
    op: z.literal("set-collection-filters"),
    filters: collectionRenderSchema.shape.filters,
  }).strict(),
]);

export const templateOperationsSchema = z
  .array(templateOperationSchema)
  .min(1)
  .max(32);

export type TemplateOperation = z.infer<typeof templateOperationSchema>;

export function parseTemplateOperations(value: unknown): TemplateOperation[] {
  return templateOperationsSchema.parse(value);
}

/**
 * AI and the visual editor mutate templates through this bounded operation set.
 * Every operation rebuilds and validates the full artifact before it can render.
 */
export function applyTemplateOperations(
  template: TemplateDefinition,
  operations: readonly TemplateOperation[],
): TemplateDefinition {
  if (operations.length > 32) throw new Error("too many template operations");
  let next: TemplateDefinition = structuredClone(template);
  for (const operation of operations) {
    switch (operation.op) {
      case "set-name":
        next = { ...next, name: operation.name };
        break;
      case "set-description":
        next = { ...next, description: operation.description || undefined };
        break;
      case "set-capabilities":
        next = { ...next, capabilities: [...operation.capabilities] };
        break;
      case "set-fields":
        next = { ...next, fields: structuredClone(operation.fields) };
        break;
      case "set-theme":
        next = { ...next, theme: structuredClone(operation.theme) };
        break;
      case "replace-item":
        next = { ...next, item: structuredClone(operation.item) };
        break;
      case "replace-collection-item":
        next = {
          ...next,
          collection: { ...next.collection, item: structuredClone(operation.item) },
        };
        break;
      case "set-collection-sort":
        next = {
          ...next,
          collection: { ...next.collection, sort: structuredClone(operation.sort) },
        };
        break;
      case "set-collection-filters":
        next = {
          ...next,
          collection: { ...next.collection, filters: structuredClone(operation.filters) },
        };
        break;
      case "set-collection-layout":
        next = {
          ...next,
          collection: {
            ...next.collection,
            layout: operation.layout,
            columns: operation.columns ?? next.collection.columns,
          },
        };
        break;
      default: {
        const unreachable: never = operation;
        throw new Error(`unsupported template operation ${JSON.stringify(unreachable)}`);
      }
    }
    next = validateTemplateDefinition(next);
  }
  return next;
}
