import { z } from "zod";

export const RENDER_SPEC_VERSION = 1 as const;
export const RENDER_ENGINE_VERSION = 1 as const;

export const SPACING_TOKENS = ["none", "xs", "sm", "md", "lg", "xl"] as const;
export const TEXT_ROLES = [
  "eyebrow",
  "title",
  "subtitle",
  "heading",
  "body",
  "caption",
  "meta",
] as const;
export const CAPABILITIES = [
  "assets",
  "capture",
  "collaboration",
  "comments",
  "import",
  "publish",
  "search",
] as const;
export const FIELD_TYPES = [
  "text",
  "richtext",
  "image",
  "date",
  "url",
  "enum",
  "number",
  "boolean",
  "reference",
] as const;

const fieldIdSchema = z.string().regex(/^[a-z][A-Za-z0-9_.-]{0,119}$/);

const fieldBase = {
  id: fieldIdSchema,
  label: z.string().trim().min(1).max(160),
  required: z.boolean().default(false),
  visibility: z.enum(["public", "editor", "hidden"]).default("public"),
  help: z.string().trim().max(500).optional(),
};

export const documentFieldDefinitionSchema = z.discriminatedUnion("type", [
  z.object({
    ...fieldBase,
    type: z.literal("text"),
    maxLength: z.number().int().positive().max(2_000_000).optional(),
  }).strict(),
  z.object({
    ...fieldBase,
    type: z.literal("richtext"),
    maxLength: z.number().int().positive().max(10_000_000).optional(),
  }).strict(),
  z.object({
    ...fieldBase,
    type: z.literal("image"),
    allowedContentTypes: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  }).strict(),
  z.object({ ...fieldBase, type: z.literal("date") }).strict(),
  z.object({ ...fieldBase, type: z.literal("url") }).strict(),
  z.object({
    ...fieldBase,
    type: z.literal("enum"),
    options: z
      .array(
        z.object({
          value: z.string().trim().min(1).max(120),
          label: z.string().trim().min(1).max(160),
        }).strict(),
      )
      .min(1)
      .max(100),
  }).strict(),
  z.object({
    ...fieldBase,
    type: z.literal("number"),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
  }).strict(),
  z.object({ ...fieldBase, type: z.literal("boolean") }).strict(),
  z.object({
    ...fieldBase,
    type: z.literal("reference"),
    target: z.enum(["document", "folder"]).default("document"),
    multiple: z.boolean().default(false),
  }).strict(),
]);

export type DocumentFieldDefinition = z.infer<typeof documentFieldDefinitionSchema>;

export const themeTokensSchema = z
  .object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    typography: z.enum(["system", "editorial", "mono"]).optional(),
    density: z.enum(["compact", "comfortable", "spacious"]).optional(),
    measure: z.enum(["narrow", "reading", "wide", "full"]).optional(),
    corners: z.enum(["square", "subtle", "rounded"]).optional(),
    surface: z.enum(["system", "paper", "soft", "ink"]).optional(),
    titleScale: z.enum(["compact", "standard", "large"]).optional(),
    alignment: z.enum(["start", "center"]).optional(),
    media: z.enum(["full", "contained", "bleed"]).optional(),
  })
  .strict();

export type ThemeTokens = z.infer<typeof themeTokensSchema>;

const bindingSchema = z
  .string()
  .regex(
    /^content\.(?:title|subtitle|body|tags|assets|fields\.[a-z][A-Za-z0-9_.-]{0,119})$/,
    "binding must reference a supported content path",
  );

export type ContentBinding = z.infer<typeof bindingSchema>;

const sharedNode = {
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/).optional(),
  showWhen: bindingSchema.optional(),
};

type RenderNodeInput =
  | {
      type: "stack";
      id?: string;
      showWhen?: string;
      direction?: "vertical" | "horizontal";
      gap?: (typeof SPACING_TOKENS)[number];
      align?: "start" | "center" | "end" | "stretch";
      children: RenderNodeInput[];
    }
  | {
      type: "group" | "masthead";
      id?: string;
      showWhen?: string;
      gap?: (typeof SPACING_TOKENS)[number];
      children: RenderNodeInput[];
    }
  | {
      type: "text";
      id?: string;
      showWhen?: string;
      bind: string;
      role: (typeof TEXT_ROLES)[number];
      fallback?: string;
      href?: string;
    }
  | { type: "prose"; id?: string; showWhen?: string; bind: string }
  | {
      type: "cover" | "image" | "video";
      id?: string;
      showWhen?: string;
      bind: string;
      alt?: string;
      fit?: "cover" | "contain";
      height?: "compact" | "medium" | "large" | "viewport";
    }
  | {
      type: "gallery";
      id?: string;
      showWhen?: string;
      bind: string;
      columns?: 1 | 2 | 3 | 4;
    }
  | { type: "byline" | "metadata"; id?: string; showWhen?: string }
  | {
      type: "divider" | "spacer";
      id?: string;
      showWhen?: string;
      size?: (typeof SPACING_TOKENS)[number];
    };

export type RenderNode =
  | (Omit<Extract<RenderNodeInput, { type: "stack" }>, "children" | "showWhen"> & {
      showWhen?: ContentBinding;
      children: RenderNode[];
    })
  | (Omit<Extract<RenderNodeInput, { type: "group" | "masthead" }>, "children" | "showWhen"> & {
      showWhen?: ContentBinding;
      children: RenderNode[];
    })
  | (Omit<Extract<RenderNodeInput, { type: "text" }>, "bind" | "showWhen"> & {
      bind: ContentBinding;
      showWhen?: ContentBinding;
      href?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "prose" }>, "bind" | "showWhen"> & {
      bind: ContentBinding;
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "cover" | "image" | "video" }>, "bind" | "alt" | "showWhen"> & {
      bind: ContentBinding;
      alt?: ContentBinding;
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "gallery" }>, "bind" | "showWhen"> & {
      bind: ContentBinding;
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "byline" | "metadata" }>, "showWhen"> & {
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "divider" | "spacer" }>, "showWhen"> & {
      showWhen?: ContentBinding;
    });

export const renderNodeSchema: z.ZodType<RenderNodeInput> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      ...sharedNode,
      type: z.literal("stack"),
      direction: z.enum(["vertical", "horizontal"]).default("vertical"),
      gap: z.enum(SPACING_TOKENS).default("md"),
      align: z.enum(["start", "center", "end", "stretch"]).default("stretch"),
      children: z.array(renderNodeSchema).min(1).max(40),
    }).strict(),
    z.object({
      ...sharedNode,
      type: z.enum(["group", "masthead"]),
      gap: z.enum(SPACING_TOKENS).default("sm"),
      children: z.array(renderNodeSchema).min(1).max(40),
    }).strict(),
    z.object({
      ...sharedNode,
      type: z.literal("text"),
      bind: bindingSchema,
      role: z.enum(TEXT_ROLES),
      fallback: z.string().max(500).optional(),
      href: bindingSchema.optional(),
    }).strict(),
    z.object({ ...sharedNode, type: z.literal("prose"), bind: bindingSchema }).strict(),
    z.object({
      ...sharedNode,
      type: z.enum(["cover", "image", "video"]),
      bind: bindingSchema,
      alt: bindingSchema.optional(),
      fit: z.enum(["cover", "contain"]).default("cover"),
      height: z.enum(["compact", "medium", "large", "viewport"]).default("medium"),
    }).strict(),
    z.object({
      ...sharedNode,
      type: z.literal("gallery"),
      bind: bindingSchema,
      columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(3),
    }).strict(),
    z.object({ ...sharedNode, type: z.enum(["byline", "metadata"]) }).strict(),
    z.object({
      ...sharedNode,
      type: z.enum(["divider", "spacer"]),
      size: z.enum(SPACING_TOKENS).default("md"),
    }).strict(),
  ]),
);

/** A sortable key: a system column, or a declared custom field addressed the
 * same way render bindings address one. Custom-field references are validated
 * against the template's declared field list in validateTemplateDefinition. */
export const collectionSortFieldSchema = z.union([
  z.enum(["createdAt", "updatedAt", "publishedAt", "title"]),
  z.string().regex(/^content\.fields\.[a-z][A-Za-z0-9_.-]{0,119}$/),
]);

/** A declarative row filter. This is data, not an expression language: one
 * field, one operator, at most one scalar. `eq` on enum/boolean fields and
 * `isSet`/`notSet` cover most real templates; the comparisons cover dates,
 * numbers, and ratings. Filters compose with AND. */
export const collectionFilterSchema = z
  .object({
    field: z.string().regex(/^content\.fields\.[a-z][A-Za-z0-9_.-]{0,119}$/),
    op: z.enum(["eq", "neq", "isSet", "notSet", "gt", "gte", "lt", "lte", "contains"]),
    value: z.union([z.string().max(20_000), z.number().finite(), z.boolean()]).optional(),
  })
  .strict()
  .superRefine((filter, ctx) => {
    const needsValue = !["isSet", "notSet"].includes(filter.op);
    if (needsValue && filter.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `filter op ${filter.op} requires a value`,
      });
    }
    if (!needsValue && filter.value !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `filter op ${filter.op} does not take a value`,
      });
    }
  });

export type CollectionFilter = z.infer<typeof collectionFilterSchema>;

export const collectionRenderSchema = z
  .object({
    layout: z.enum(["list", "cards", "timeline", "index", "single"]),
    columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(3),
    gap: z.enum(SPACING_TOKENS).default("md"),
    sort: z
      .array(
        z.object({
          field: collectionSortFieldSchema,
          direction: z.enum(["asc", "desc"]),
        }).strict(),
      )
      .max(4)
      .default([]),
    filters: z.array(collectionFilterSchema).max(8).default([]),
    item: renderNodeSchema,
  })
  .strict();

export type CollectionRenderSpec = z.infer<typeof collectionRenderSchema>;

export const templateDefinitionSchema = z
  .object({
    schemaVersion: z.literal(RENDER_SPEC_VERSION),
    engineVersion: z.literal(RENDER_ENGINE_VERSION),
    id: z.string().regex(/^[a-z][a-z0-9.-]{2,159}$/),
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional(),
    fields: z.array(documentFieldDefinitionSchema).max(80).default([]),
    item: renderNodeSchema,
    collection: collectionRenderSchema,
    capabilities: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length).default([]),
    theme: themeTokensSchema.default({}),
  })
  .strict();

export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;

function visitTree(
  node: RenderNodeInput,
  visitor: (node: RenderNodeInput) => void,
  depth = 1,
  count = { value: 0 },
): void {
  count.value += 1;
  if (depth > 12) throw new Error("render spec exceeds the maximum depth of 12");
  if (count.value > 160) throw new Error("render spec exceeds the maximum node count of 160");
  visitor(node);
  if ("children" in node) {
    for (const child of node.children) visitTree(child, visitor, depth + 1, count);
  }
}

type BindingKind = (typeof FIELD_TYPES)[number] | "assets" | "tags";
const ALL_BINDING_KINDS: readonly BindingKind[] = [...FIELD_TYPES, "assets", "tags"];

const CORE_BINDINGS: Record<string, BindingKind> = {
  "content.title": "text",
  "content.subtitle": "text",
  "content.body": "richtext",
  "content.tags": "tags",
  "content.assets": "assets",
};

function bindingKind(
  binding: string,
  fields: ReadonlyMap<string, DocumentFieldDefinition>,
): BindingKind | null {
  const core = CORE_BINDINGS[binding];
  if (core) return core;
  if (!binding.startsWith("content.fields.")) return null;
  return fields.get(binding.slice("content.fields.".length))?.type ?? null;
}

function checkBinding(
  binding: string,
  fields: ReadonlyMap<string, DocumentFieldDefinition>,
  allowed: readonly BindingKind[],
  context: string,
): void {
  const kind = bindingKind(binding, fields);
  if (!kind) throw new Error(`${context} references undeclared field ${binding}`);
  if (!allowed.includes(kind)) {
    throw new Error(`${context} cannot consume ${kind} binding ${binding}`);
  }
}

function validateTreeBindings(
  root: RenderNodeInput,
  fields: ReadonlyMap<string, DocumentFieldDefinition>,
  ids: Set<string>,
): void {
  visitTree(root, (node) => {
    if (node.id) {
      if (ids.has(node.id)) throw new Error(`render node id ${node.id} is duplicated`);
      ids.add(node.id);
    }
    if (node.showWhen) {
      checkBinding(node.showWhen, fields, ALL_BINDING_KINDS, "showWhen");
    }
    if (node.type === "text") {
      checkBinding(
        node.bind,
        fields,
        ["text", "date", "url", "enum", "number", "boolean", "reference", "tags"],
        "text",
      );
    } else if (node.type === "prose") {
      checkBinding(node.bind, fields, ["richtext", "text"], "prose");
    } else if (node.type === "cover" || node.type === "image" || node.type === "video") {
      checkBinding(node.bind, fields, ["image", "url"], node.type);
      if (node.alt) checkBinding(node.alt, fields, ["text", "enum", "url"], `${node.type} alt`);
    } else if (node.type === "gallery") {
      checkBinding(node.bind, fields, ["assets"], "gallery");
    }
  });
}

export function validateRenderSpec(value: unknown): RenderNode {
  const node = renderNodeSchema.parse(value);
  visitTree(node, () => undefined);
  return node as RenderNode;
}

export function validateTemplateDefinition(value: unknown): TemplateDefinition {
  const template = templateDefinitionSchema.parse(value);
  const fields = new Map<string, DocumentFieldDefinition>();
  for (const field of template.fields) {
    if (fields.has(field.id)) throw new Error(`field id ${field.id} is duplicated`);
    if (field.type === "enum") {
      const values = new Set(field.options.map((option) => option.value));
      if (values.size !== field.options.length) {
        throw new Error(`enum field ${field.id} has duplicate option values`);
      }
    }
    if (field.type === "number" && field.min != null && field.max != null && field.min > field.max) {
      throw new Error(`number field ${field.id} has min greater than max`);
    }
    fields.set(field.id, field);
  }
  validateTreeBindings(template.item, fields, new Set<string>());
  validateTreeBindings(template.collection.item, fields, new Set<string>());
  // Sort keys and filters may only reference fields this template declares.
  // A reference to an undeclared field is not "empty for every document", it
  // is a template bug, and it fails here rather than rendering surprisingly.
  const FIELD_PREFIX = "content.fields.";
  for (const entry of template.collection.sort) {
    if (!entry.field.startsWith(FIELD_PREFIX)) continue;
    const id = entry.field.slice(FIELD_PREFIX.length);
    if (!fields.has(id)) {
      throw new Error(`collection sort references undeclared field ${id}`);
    }
  }
  for (const filter of template.collection.filters) {
    const id = filter.field.slice(FIELD_PREFIX.length);
    const declared = fields.get(id);
    if (!declared) {
      throw new Error(`collection filter references undeclared field ${id}`);
    }
    if (filter.op === "contains" && declared.type !== "text" && declared.type !== "richtext") {
      throw new Error(`filter op contains requires a text field, not ${declared.type} (${id})`);
    }
    if (["gt", "gte", "lt", "lte"].includes(filter.op) &&
        !["number", "date"].includes(declared.type)) {
      throw new Error(`filter op ${filter.op} requires a number or date field, not ${declared.type} (${id})`);
    }
  }
  if (new Set(template.capabilities).size !== template.capabilities.length) {
    throw new Error("template capabilities must be unique");
  }
  return template;
}
