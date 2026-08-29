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
  /**
   * A page icon: one emoji, set large, sitting over the cover above it when
   * there is one. The built-in Page look drew this with per-template CSS keyed
   * to a node id, which an authored look has no way to reach - so a look could
   * not express an icon at all, and every request for a Notion-shaped page
   * came back without one.
   */
  "icon",
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
  "rows",
] as const;

const fieldIdSchema = z.string().regex(/^[a-z][A-Za-z0-9_.-]{0,119}$/);

const fieldBase = {
  id: fieldIdSchema,
  label: z.string().trim().min(1).max(160),
  required: z.boolean().default(false),
  visibility: z.enum(["public", "editor", "hidden"]).default("public"),
  help: z.string().trim().max(500).optional(),
};

// The scalar field shapes. Rows reuse these for sub-fields, so they are named
// members rather than inline union literals.

const textFieldSchema = z.object({
  ...fieldBase,
  type: z.literal("text"),
  maxLength: z.number().int().positive().max(2_000_000).optional(),
}).strict();

const richtextFieldSchema = z.object({
  ...fieldBase,
  type: z.literal("richtext"),
  maxLength: z.number().int().positive().max(10_000_000).optional(),
}).strict();

const imageFieldSchema = z.object({
  ...fieldBase,
  type: z.literal("image"),
  allowedContentTypes: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
}).strict();

const dateFieldSchema = z.object({ ...fieldBase, type: z.literal("date") }).strict();

const urlFieldSchema = z.object({ ...fieldBase, type: z.literal("url") }).strict();

const enumFieldSchema = z.object({
  ...fieldBase,
  type: z.literal("enum"),
  options: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(120),
        label: z.string().trim().min(1).max(160),
        /** Engine-owned tint, validated in light AND dark; never user CSS.
         * This is how a status pill gets its color without any color input. */
        tone: z
          .enum(["neutral", "info", "success", "warning", "danger", "accent"])
          .optional(),
        /** A single emoji, rendered before the label in badges. */
        icon: z.string().trim().min(1).max(8).optional(),
      }).strict(),
    )
    .min(1)
    .max(100),
  /** Labels, genres, moods: multiple selected values stored as string[]. */
  multiple: z.boolean().default(false),
  /** Optional domain meaning retained without changing storage. Status keeps
   * a closed transition graph; recurrence stores one safe preset string. */
  semantic: z.enum(["status", "recurrence"]).optional(),
  workflow: z
    .object({
      initial: z.string().trim().min(1).max(120),
      completed: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
      transitions: z
        .array(
          z
            .object({
              from: z.string().trim().min(1).max(120),
              to: z.string().trim().min(1).max(120),
            })
            .strict(),
        )
        .max(100)
        .default([]),
    })
    .strict()
    .optional(),
}).strict();

const numberFieldSchema = z.object({
  ...fieldBase,
  type: z.literal("number"),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  /** How the value displays: rating renders stars against `max`, minutes
   * renders "1 h 20 m", currency and percent localize. Storage stays a plain
   * number in every case. */
  format: z
    .enum(["plain", "currency", "percent", "minutes", "rating"])
    .default("plain"),
}).strict();

const booleanFieldSchema = z.object({ ...fieldBase, type: z.literal("boolean") }).strict();

const referenceFieldSchema = z.object({
  ...fieldBase,
  type: z.literal("reference"),
  target: z.enum(["document", "folder"]).default("document"),
  multiple: z.boolean().default(false),
  /** People are ordinary TextText documents linked through the canonical
   * reference value. No separate contact model or account data is introduced. */
  semantic: z.enum(["relation", "people"]).optional(),
}).strict();

/** Sub-fields a row may declare: every scalar type, no rows-in-rows and no
 * richtext, so a row stays a record rather than a document. */
export const rowSubFieldSchema = z.discriminatedUnion("type", [
  textFieldSchema,
  imageFieldSchema,
  dateFieldSchema,
  urlFieldSchema,
  enumFieldSchema,
  numberFieldSchema,
  booleanFieldSchema,
  referenceFieldSchema,
]);

export type RowSubFieldDefinition = z.infer<typeof rowSubFieldSchema>;

export const documentFieldDefinitionSchema = z.discriminatedUnion("type", [
  textFieldSchema,
  richtextFieldSchema,
  imageFieldSchema,
  dateFieldSchema,
  urlFieldSchema,
  enumFieldSchema,
  numberFieldSchema,
  booleanFieldSchema,
  referenceFieldSchema,
  // The rows field: an array of typed records. Subtasks, ingredients, action
  // items, changelog entries, itinerary stops, metrics: every "repeating
  // group" is this one type.
  z.object({
    ...fieldBase,
    type: z.literal("rows"),
    fields: z.array(rowSubFieldSchema).min(1).max(8),
    maxRows: z.number().int().positive().max(500).default(200),
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
    /**
     * How big the body sets. A look could say how large its TITLE was and not
     * how large its text was, so a reading-first look - the whole point of
     * something like Medium - could not be expressed: every look got 17px
     * whatever it asked for.
     */
    bodyScale: z.enum(["compact", "standard", "relaxed"]).optional(),
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

type ContentBinding = z.infer<typeof bindingSchema>;

/** Bindings inside a rows-bound node address the row's sub-fields. */
const rowBindingSchema = z
  .string()
  .regex(/^row\.[a-z][A-Za-z0-9_.-]{0,119}$/);

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
      type: "media";
      id?: string;
      showWhen?: string;
      bind: string;
      /** What the asset is. Carries the class and the video player branch. */
      kind?: "cover" | "image" | "video";
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
      type: "meta";
      id?: string;
      showWhen?: string;
      variant?: "byline" | "metadata";
    }
  | {
      type: "divider" | "spacer";
      id?: string;
      showWhen?: string;
      size?: (typeof SPACING_TOKENS)[number];
    }
  | {
      type: "space";
      id?: string;
      showWhen?: string;
      size?: (typeof SPACING_TOKENS)[number];
      /** True draws a rule, false leaves the gap empty. */
      rule?: boolean;
    }
  | {
      type: "badge";
      id?: string;
      showWhen?: string;
      bind: string;
      variant?: "pill" | "chips" | "glyph";
      showIcon?: boolean;
    }
  | {
      type: "toggle";
      id?: string;
      showWhen?: string;
      bind: string;
      labelBind?: string;
      variant?: "circle" | "square";
    }
  | {
      type: "facts";
      id?: string;
      showWhen?: string;
      variant?: "table" | "strip" | "pills";
      entries: {
        bind: string;
        label?: string;
        format?: "date" | "relative" | "countdown";
        derive?:
          | { op: "count" }
          | { op: "sum"; of: string }
          | { op: "doneOf"; of: string };
      }[];
    }
  | {
      type: "checklist";
      id?: string;
      showWhen?: string;
      bind: string;
      doneBind: string;
      labelBind: string;
      meta?: string[];
      mode?: "document" | "reader";
      sortCheckedLast?: boolean;
      rollup?: boolean;
    }
  | {
      type: "rows";
      id?: string;
      showWhen?: string;
      bind: string;
      variant?: "table" | "steps" | "timeline" | "tiles";
      columns?: { bind: string; label?: string }[];
      sort?: { bind: string; direction: "asc" | "desc" };
    }
  | {
      type: "poll";
      id?: string;
      showWhen?: string;
      bind: string;
      labelBind: string;
      multiple?: boolean;
      closesBind?: string;
    }
  | {
      type: "progress";
      id?: string;
      showWhen?: string;
      variant?: "bar" | "ring" | "fraction";
      source:
        | { bind: string }
        | { currentBind: string; targetBind: string }
        | { checklistBind: string; doneBind: string };
    }
  | {
      type: "callout";
      id?: string;
      showWhen?: string;
      tone?: "note" | "tip" | "success" | "warning" | "danger" | "decision";
      title?: string;
      icon?: string;
      children: RenderNodeInput[];
    }
  | {
      type: "quote";
      id?: string;
      showWhen?: string;
      bind: string;
      variant?: "block" | "pull" | "attributed";
      attributionBind?: string;
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
  | (Omit<Extract<RenderNodeInput, { type: "media" }>, "bind" | "alt" | "showWhen"> & {
      bind: ContentBinding;
      alt?: ContentBinding;
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "gallery" }>, "bind" | "showWhen"> & {
      bind: ContentBinding;
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "meta" }>, "showWhen"> & {
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "space" }>, "showWhen"> & {
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "byline" | "metadata" }>, "showWhen"> & {
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "divider" | "spacer" }>, "showWhen"> & {
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "badge" }>, "bind" | "showWhen"> & {
      bind: ContentBinding | string;
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "toggle" }>, "bind" | "showWhen"> & {
      bind: ContentBinding | string;
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "facts" }>, "showWhen"> & {
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "checklist" }>, "bind" | "showWhen"> & {
      bind: ContentBinding;
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "rows" }>, "bind" | "showWhen"> & {
      bind: ContentBinding;
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "poll" }>, "bind" | "showWhen"> & {
      bind: ContentBinding;
      showWhen?: ContentBinding;
      closesBind?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "progress" }>, "showWhen"> & {
      showWhen?: ContentBinding;
    })
  | (Omit<Extract<RenderNodeInput, { type: "callout" }>, "children" | "showWhen"> & {
      showWhen?: ContentBinding;
      children: RenderNode[];
    })
  | (Omit<Extract<RenderNodeInput, { type: "quote" }>, "bind" | "showWhen"> & {
      bind: ContentBinding;
      showWhen?: ContentBinding;
    });

/**
 * Rewrite a legacy node spelling into the one the engine keeps.
 *
 * Applied at the RENDERER, not on parse. Normalising on parse rewrites the
 * object every serializer downstream then writes out, so from the moment it
 * shipped, sync, look export and newly compiled types would all emit the new
 * names. A textpack exported after that cannot be read by an earlier build,
 * and no database migration can reach a bundle already on someone's disk.
 * Reading both and writing neither keeps a rollback safe.
 *
 * One exported mapping, so the renderer today and the migration later cannot
 * disagree about what a legacy node becomes.
 */
export function normalizeRenderNode(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const node = value as Record<string, unknown>;
  // Only rewrite a node that is ACTUALLY the legacy shape. One already
  // carrying a target-only key is a faulty producer, and overwriting it would
  // accept input the strict schemas reject.
  if ((node.type === "byline" || node.type === "metadata") && !("variant" in node)) {
    return { ...node, type: "meta", variant: node.type };
  }
  if ((node.type === "divider" || node.type === "spacer") && !("rule" in node)) {
    return { ...node, type: "space", rule: node.type === "divider" };
  }
  if (
    (node.type === "cover" || node.type === "image" || node.type === "video") &&
    !("kind" in node)
  ) {
    return { ...node, type: "media", kind: node.type };
  }
  return node;
}

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
    // cover, image and video are one node: same properties, one renderer
    // branch. `media` is the name they normalise to at render time; all four
    // spellings are accepted, and only these three are emitted today.
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
      type: z.literal("media"),
      kind: z.enum(["cover", "image", "video"]).default("image"),
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
    // byline and metadata are the same node with one difference. Both spellings
    // are still accepted on input and normalised to `meta` before anything
    // downstream sees them; see normalizeRenderNode below.
    z.object({ ...sharedNode, type: z.enum(["byline", "metadata"]) }).strict(),
    z.object({
      ...sharedNode,
      type: z.literal("meta"),
      variant: z.enum(["byline", "metadata"]).default("byline"),
    }).strict(),
    // divider and spacer differ only in whether a rule is drawn.
    z.object({
      ...sharedNode,
      type: z.enum(["divider", "spacer"]),
      size: z.enum(SPACING_TOKENS).default("md"),
    }).strict(),
    z.object({
      ...sharedNode,
      type: z.literal("space"),
      size: z.enum(SPACING_TOKENS).default("md"),
      rule: z.boolean().default(false),
    }).strict(),
    // --- Wave-1 nodes from the document-types research. Each earns its place
    // by serving several templates; none accepts user markup or color. ---
    // badge: enum -> tinted pill; tags/multi-enum -> pill row; boolean ->
    // glyph; reference -> chip. The one node behind every status/priority/
    // label treatment.
    z.object({
      ...sharedNode,
      type: z.literal("badge"),
      bind: z.union([bindingSchema, rowBindingSchema]),
      variant: z.enum(["pill", "chips", "glyph"]).default("pill"),
      showIcon: z.boolean().default(true),
    }).strict(),
    // toggle: one boolean, drawn as the mark a person recognises - a filled
    // circle when it is on, an empty one when it is not. `checklist` covers a
    // rows field, so a single flag had no visual form at all: a task list's
    // defining element could not be put on a row, and every to-do collection
    // came back as a list of titles.
    z.object({
      ...sharedNode,
      type: z.literal("toggle"),
      bind: z.union([bindingSchema, rowBindingSchema]),
      /** Text beside the mark. Usually the thing being ticked off. */
      labelBind: z.union([bindingSchema, rowBindingSchema]).optional(),
      variant: z.enum(["circle", "square"]).default("circle"),
    }).strict(),
    // facts: the labeled metadata header. table | strip | pills; empty
    // entries are skipped so heavy optional schemas stay light. An entry may
    // DERIVE its value from a rows field instead of reading a scalar: count
    // of rows, sum of a numeric sub-field, or a done-of-total fraction.
    z.object({
      ...sharedNode,
      type: z.literal("facts"),
      variant: z.enum(["table", "strip", "pills"]).default("strip"),
      entries: z
        .array(
          z.object({
            bind: bindingSchema,
            label: z.string().trim().min(1).max(80).optional(),
            format: z.enum(["date", "relative", "countdown"]).optional(),
            derive: z
              .discriminatedUnion("op", [
                z.object({ op: z.literal("count") }).strict(),
                z.object({ op: z.literal("sum"), of: rowBindingSchema }).strict(),
                z.object({ op: z.literal("doneOf"), of: rowBindingSchema }).strict(),
              ])
              .optional(),
          }).strict(),
        )
        .min(1)
        .max(12),
    }).strict(),
    // checklist: rows field + boolean sub-field. mode document persists checks
    // as a document mutation; mode reader keeps them per-viewer and ephemeral
    // (recipe ingredients, packing lists on a shared page).
    z.object({
      ...sharedNode,
      type: z.literal("checklist"),
      bind: bindingSchema,
      doneBind: rowBindingSchema,
      labelBind: rowBindingSchema,
      meta: z.array(rowBindingSchema).max(4).default([]),
      mode: z.enum(["document", "reader"]).default("document"),
      sortCheckedLast: z.boolean().default(true),
      rollup: z.boolean().default(false),
    }).strict(),
    // rows: table | steps | timeline | tiles over a rows field. Registers,
    // procedures, dated logs, and stat rows are four variants of one node.
    z.object({
      ...sharedNode,
      type: z.literal("rows"),
      bind: bindingSchema,
      variant: z.enum(["table", "steps", "timeline", "tiles"]).default("table"),
      columns: z
        .array(
          z.object({
            bind: rowBindingSchema,
            label: z.string().trim().min(1).max(80).optional(),
          }).strict(),
        )
        .max(8)
        .default([]),
      sort: z
        .object({
          bind: rowBindingSchema,
          direction: z.enum(["asc", "desc"]),
        })
        .strict()
        .optional(),
    }).strict(),
    // poll: a rows field supplies the options (so each document writes its
    // own); reader responses live in their own table, never in the document.
    // The widget collects votes on public published pages and shows tallies.
    z.object({
      ...sharedNode,
      type: z.literal("poll"),
      bind: bindingSchema,
      labelBind: rowBindingSchema,
      multiple: z.boolean().default(false),
      closesBind: bindingSchema.optional(),
    }).strict(),
    // progress: computed display only. A 0..1 number, a current/target pair,
    // or a checklist rollup.
    z.object({
      ...sharedNode,
      type: z.literal("progress"),
      variant: z.enum(["bar", "ring", "fraction"]).default("bar"),
      source: z.union([
        z.object({ bind: bindingSchema }).strict(),
        z.object({ currentBind: bindingSchema, targetBind: bindingSchema }).strict(),
        z.object({ checklistBind: bindingSchema, doneBind: rowBindingSchema }).strict(),
      ]),
    }).strict(),
    // callout: closed tones, engine-owned tint in both themes.
    z.object({
      ...sharedNode,
      type: z.literal("callout"),
      tone: z.enum(["note", "tip", "success", "warning", "danger", "decision"]).default("note"),
      title: z.string().trim().min(1).max(160).optional(),
      icon: z.string().trim().min(1).max(8).optional(),
      children: z.array(renderNodeSchema).min(1).max(20),
    }).strict(),
    // quote: block | pull | attributed.
    z.object({
      ...sharedNode,
      type: z.literal("quote"),
      bind: bindingSchema,
      variant: z.enum(["block", "pull", "attributed"]).default("block"),
      attributionBind: bindingSchema.optional(),
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

const collectionViewSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
    name: z.string().trim().min(1).max(80),
    layout: z.enum([
      "list",
      "cards",
      "timeline",
      "index",
      "single",
      "board",
      "calendar",
      "heatmap",
    ]),
    columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1),
    groupBy: z
      .string()
      .regex(/^content\.fields\.[a-z][A-Za-z0-9_.-]{0,119}$/)
      .optional(),
    dateBy: z
      .string()
      .regex(/^content\.fields\.[a-z][A-Za-z0-9_.-]{0,119}$/)
      .optional(),
    sort: z
      .array(
        z
          .object({
            field: collectionSortFieldSchema,
            direction: z.enum(["asc", "desc"]),
          })
          .strict(),
      )
      .max(4)
      .default([]),
    filters: z.array(collectionFilterSchema).max(8).default([]),
  })
  .strict();

export type CollectionViewSpec = z.infer<typeof collectionViewSchema>;

export const collectionRenderSchema = z
  .object({
    layout: z.enum([
      "list",
      "cards",
      "timeline",
      "index",
      "single",
      "board",
      "calendar",
      "heatmap",
    ]),
    columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(3),
    gap: z.enum(SPACING_TOKENS).default("md"),
    /** Board grouping: one column per option of a single-select enum field,
     * plus an unsorted column for items without a value. Only meaningful for
     * the board layout; validated against the declared fields. */
    groupBy: z
      .string()
      .regex(/^content\.fields\.[a-z][A-Za-z0-9_.-]{0,119}$/)
      .optional(),
    /** Calendar placement: the declared date field whose value puts an item
     * on a day. Only meaningful for the calendar layout. */
    dateBy: z
      .string()
      .regex(/^content\.fields\.[a-z][A-Za-z0-9_.-]{0,119}$/)
      .optional(),
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
    /** Named folder views reuse the same item renderer and field declarations.
     * They only vary safe query and layout data. */
    views: z.array(collectionViewSchema).max(12).default([]),
    defaultView: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/).optional(),
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
    theme: themeTokensSchema.default({}),
    /** Example content travels with a look so a new or custom type can show a
     * meaningful preview before the workspace contains any items of that type. */
    example: z
      .object({
        title: z.string().max(20_000).default(""),
        subtitle: z.string().max(100_000).optional(),
        body: z.string().max(10_000_000).default(""),
        fields: z
          .record(
            fieldIdSchema,
            z.union([
              z.string().max(2_000_000),
              z.number().finite(),
              z.boolean(),
              z.null(),
              z.array(z.string().max(20_000)).max(500),
              z
                .array(
                  z.record(
                    fieldIdSchema,
                    z.union([
                      z.string().max(20_000),
                      z.number().finite(),
                      z.boolean(),
                      z.null(),
                    ]),
                  ),
                )
                .max(500),
            ]),
          )
          .default({}),
        tags: z.array(z.string().trim().min(1).max(120)).max(500).default([]),
      })
      .strict()
      .optional(),
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

/**
 * What a caller could have written instead. These messages are the only
 * feedback an agent authoring a look ever gets, and "references undeclared
 * field x" leaves it guessing at the vocabulary; naming what IS available
 * turns a retry into a correction.
 */
function bindingVocabulary(
  fields: ReadonlyMap<string, DocumentFieldDefinition>,
): string {
  const declared = [...fields.keys()].map((id) => `content.fields.${id}`);
  const available = [...Object.keys(CORE_BINDINGS), ...declared];
  return available.length
    ? ` Available bindings: ${available.join(", ")}.`
    : " This template declares no fields, so only the core bindings exist.";
}

function checkBinding(
  binding: string,
  fields: ReadonlyMap<string, DocumentFieldDefinition>,
  allowed: readonly BindingKind[],
  context: string,
): void {
  const kind = bindingKind(binding, fields);
  if (!kind) {
    throw new Error(
      `${context} references undeclared field ${binding}.${bindingVocabulary(fields)}`,
    );
  }
  if (!allowed.includes(kind)) {
    throw new Error(
      `${context} cannot consume ${kind} binding ${binding}. It accepts: ${allowed.join(", ")}.`,
    );
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
    } else if (
      node.type === "cover" ||
      node.type === "image" ||
      node.type === "video" ||
      node.type === "media"
    ) {
      // media is the name the three normalise to. Without it here a media node
      // would skip binding validation entirely, which is silent: the look
      // saves, and the binding is only discovered to be wrong when a reader
      // opens the page.
      checkBinding(node.bind, fields, ["image", "url"], node.type);
      if (node.alt) checkBinding(node.alt, fields, ["text", "enum", "url"], `${node.type} alt`);
    } else if (node.type === "gallery") {
      checkBinding(node.bind, fields, ["assets"], "gallery");
    } else if (node.type === "badge") {
      // Row-scoped badges are validated by their enclosing rows/checklist
      // node, which knows the sub-field list; a top-level badge validates here.
      if (!node.bind.startsWith("row.")) {
        checkBinding(
          node.bind,
          fields,
          ["enum", "boolean", "reference", "tags", "text"],
          "badge",
        );
      }
    } else if (node.type === "toggle") {
      if (!node.bind.startsWith("row.")) {
        checkBinding(node.bind, fields, ["boolean"], "toggle");
      }
      if (node.labelBind && !node.labelBind.startsWith("row.")) {
        checkBinding(
          node.labelBind,
          fields,
          ["text", "enum", "url", "date", "number"],
          "toggle label",
        );
      }
    } else if (node.type === "facts") {
      for (const entry of node.entries) {
        if (entry.derive) {
          const derive = entry.derive;
          requireRowsField(entry.bind, fields, "facts derive", (sub) => {
            if (derive.op === "sum") {
              requireRowBinding(derive.of, sub, ["number"], "facts sum of");
            } else if (derive.op === "doneOf") {
              requireRowBinding(derive.of, sub, ["boolean"], "facts doneOf of");
            }
          });
          continue;
        }
        checkBinding(
          entry.bind,
          fields,
          ["text", "date", "url", "enum", "number", "boolean", "reference", "tags"],
          "facts entry",
        );
      }
    } else if (node.type === "checklist") {
      requireRowsField(node.bind, fields, "checklist", (sub) => {
        requireRowBinding(node.doneBind, sub, ["boolean"], "checklist doneBind");
        requireRowBinding(node.labelBind, sub, ["text", "url"], "checklist labelBind");
        for (const meta of node.meta ?? []) {
          requireRowBinding(meta, sub, ["text", "date", "url", "enum", "number", "boolean"], "checklist meta");
        }
      });
    } else if (node.type === "rows") {
      requireRowsField(node.bind, fields, "rows", (sub) => {
        for (const column of node.columns ?? []) {
          requireRowBinding(column.bind, sub, null, "rows column");
        }
        if (node.sort) requireRowBinding(node.sort.bind, sub, null, "rows sort");
      });
    } else if (node.type === "poll") {
      requireRowsField(node.bind, fields, "poll", (sub) => {
        requireRowBinding(node.labelBind, sub, ["text"], "poll labelBind");
      });
      if (node.closesBind) {
        checkBinding(node.closesBind, fields, ["date"], "poll closesBind");
      }
    } else if (node.type === "progress") {
      const source = node.source;
      if ("bind" in source) {
        checkBinding(source.bind, fields, ["number"], "progress");
      } else if ("currentBind" in source) {
        checkBinding(source.currentBind, fields, ["number"], "progress current");
        checkBinding(source.targetBind, fields, ["number"], "progress target");
      } else {
        requireRowsField(source.checklistBind, fields, "progress checklist", (sub) => {
          requireRowBinding(source.doneBind, sub, ["boolean"], "progress doneBind");
        });
      }
    } else if (node.type === "quote") {
      checkBinding(node.bind, fields, ["text", "richtext"], "quote");
      if (node.attributionBind) {
        checkBinding(node.attributionBind, fields, ["text", "url", "reference"], "quote attribution");
      }
    }
  });
}

/** Resolve a binding to a declared rows field and hand its sub-field map to
 * the caller, so row.* bindings are checked against the RIGHT row shape. */
function requireRowsField(
  binding: string,
  fields: ReadonlyMap<string, DocumentFieldDefinition>,
  context: string,
  check: (subFields: ReadonlyMap<string, RowSubFieldDefinition>) => void,
): void {
  const id = binding.startsWith("content.fields.")
    ? binding.slice("content.fields.".length)
    : null;
  const field = id ? fields.get(id) : undefined;
  if (!field || field.type !== "rows") {
    throw new Error(`${context} must bind a declared rows field, got ${binding}`);
  }
  const subFields = new Map(field.fields.map((sub) => [sub.id, sub]));
  check(subFields);
}

function requireRowBinding(
  binding: string,
  subFields: ReadonlyMap<string, RowSubFieldDefinition>,
  allowed: readonly RowSubFieldDefinition["type"][] | null,
  context: string,
): void {
  if (!binding.startsWith("row.")) {
    throw new Error(`${context} must be a row.* binding, got ${binding}`);
  }
  const sub = subFields.get(binding.slice("row.".length));
  if (!sub) {
    throw new Error(`${context} references undeclared row sub-field ${binding}`);
  }
  if (allowed && !allowed.includes(sub.type)) {
    throw new Error(`${context} requires ${allowed.join("|")}, got ${sub.type} (${binding})`);
  }
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
      if (field.semantic === "recurrence" && field.multiple) {
        throw new Error(`recurrence field ${field.id} must be single-select`);
      }
      if (field.workflow) {
        if (field.multiple || field.semantic !== "status") {
          throw new Error(`workflow field ${field.id} must be a single-select status`);
        }
        const workflowValues = [
          field.workflow.initial,
          ...field.workflow.completed,
          ...field.workflow.transitions.flatMap((transition) => [
            transition.from,
            transition.to,
          ]),
        ];
        for (const value of workflowValues) {
          if (!values.has(value)) {
            throw new Error(`workflow field ${field.id} references unknown option ${value}`);
          }
        }
        const transitions = field.workflow.transitions.map(
          (transition) => `${transition.from}\u0000${transition.to}`,
        );
        if (new Set(transitions).size !== transitions.length) {
          throw new Error(`workflow field ${field.id} has duplicate transitions`);
        }
      }
    }
    if (field.type === "number" && field.min != null && field.max != null && field.min > field.max) {
      throw new Error(`number field ${field.id} has min greater than max`);
    }
    fields.set(field.id, field);
  }
  for (const id of Object.keys(template.example?.fields ?? {})) {
    if (!fields.has(id)) {
      throw new Error(`template example references undeclared field ${id}`);
    }
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
  if (template.collection.groupBy) {
    const id = template.collection.groupBy.slice(FIELD_PREFIX.length);
    const declared = fields.get(id);
    if (!declared) {
      throw new Error(`collection groupBy references undeclared field ${id}`);
    }
    if (declared.type !== "enum" || declared.multiple) {
      throw new Error(
        `collection groupBy requires a single-select enum field, not ${declared.type} (${id})`,
      );
    }
  }
  if (template.collection.dateBy) {
    const id = template.collection.dateBy.slice(FIELD_PREFIX.length);
    const declared = fields.get(id);
    if (!declared) {
      throw new Error(`collection dateBy references undeclared field ${id}`);
    }
    if (declared.type !== "date") {
      throw new Error(
        `collection dateBy requires a date field, not ${declared.type} (${id})`,
      );
    }
  }
  const viewIds = new Set<string>();
  for (const view of template.collection.views) {
    if (viewIds.has(view.id)) {
      throw new Error(`collection view id ${view.id} is duplicated`);
    }
    viewIds.add(view.id);
    for (const entry of view.sort) {
      if (!entry.field.startsWith(FIELD_PREFIX)) continue;
      const id = entry.field.slice(FIELD_PREFIX.length);
      if (!fields.has(id)) {
        throw new Error(`collection view ${view.id} sort references undeclared field ${id}`);
      }
    }
    for (const filter of view.filters) {
      const id = filter.field.slice(FIELD_PREFIX.length);
      const declared = fields.get(id);
      if (!declared) {
        throw new Error(`collection view ${view.id} filter references undeclared field ${id}`);
      }
      if (filter.op === "contains" && declared.type !== "text" && declared.type !== "richtext") {
        throw new Error(
          `collection view ${view.id} filter op contains requires a text field, not ${declared.type} (${id})`,
        );
      }
      if (
        ["gt", "gte", "lt", "lte"].includes(filter.op) &&
        !["number", "date"].includes(declared.type)
      ) {
        throw new Error(
          `collection view ${view.id} filter op ${filter.op} requires a number or date field, not ${declared.type} (${id})`,
        );
      }
    }
    if (view.groupBy) {
      const id = view.groupBy.slice(FIELD_PREFIX.length);
      const declared = fields.get(id);
      if (!declared) {
        throw new Error(`collection view ${view.id} groupBy references undeclared field ${id}`);
      }
      if (declared.type !== "enum" || declared.multiple) {
        throw new Error(
          `collection view ${view.id} groupBy requires a single-select enum field, not ${declared.type} (${id})`,
        );
      }
    }
    if (view.layout === "board" && !view.groupBy) {
      throw new Error(`collection view ${view.id} board needs groupBy`);
    }
    if (view.dateBy) {
      const id = view.dateBy.slice(FIELD_PREFIX.length);
      const declared = fields.get(id);
      if (!declared) {
        throw new Error(`collection view ${view.id} dateBy references undeclared field ${id}`);
      }
      if (declared.type !== "date") {
        throw new Error(
          `collection view ${view.id} dateBy requires a date field, not ${declared.type} (${id})`,
        );
      }
    }
    if (["calendar", "heatmap"].includes(view.layout) && !view.dateBy) {
      throw new Error(`collection view ${view.id} ${view.layout} needs dateBy`);
    }
  }
  if (template.collection.defaultView && !viewIds.has(template.collection.defaultView)) {
    throw new Error(
      `collection defaultView references undeclared view ${template.collection.defaultView}`,
    );
  }
  return template;
}
