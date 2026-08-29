import { z } from "zod";
import {
  themeTokensSchema,
  validateTemplateDefinition,
  type DocumentFieldDefinition,
  type RenderNode,
  type TemplateDefinition,
  type ThemeTokens,
} from "@/lib/presentation/schema";

const fieldId = z.string().regex(/^[a-z][A-Za-z0-9_.-]{0,119}$/);

const enumOption = z
  .object({
    value: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(160),
    tone: z
      .enum(["neutral", "info", "success", "warning", "danger", "accent"])
      .optional(),
    icon: z.string().trim().min(1).max(8).optional(),
  })
  .strict();

const fieldValidation = z
  .object({
    maxLength: z.number().int().positive().max(10_000_000).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
  })
  .strict();

const workflow = z
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
  .strict();

const scalarField = z
  .object({
    id: fieldId,
    label: z.string().trim().min(1).max(160),
    type: z.enum([
      "text",
      "richtext",
      "image",
      "date",
      "url",
      "enum",
      "number",
      "boolean",
      "reference",
      "people",
      "recurrence",
    ]),
    required: z.boolean().default(false),
    help: z.string().trim().max(500).optional(),
    // "fact" is gone. Nothing ever branched on it for a scalar field: a plain
    // scalar falls through into the facts strip whether it says "fact" or
    // "auto", so the two produced identical output and the model was being
    // asked to make a choice that could not change anything.
    //
    // Removed rather than aliased, because a blueprint is transient. Saving
    // compiles it and persists only the TemplateDefinition, so there is no
    // stored blueprint to stay compatible with. A transform here would also
    // break the JSON Schema this becomes as a tool argument.
    display: z
      .enum(["auto", "hidden", "cover", "badge", "toggle", "section"])
      .default("auto"),
    options: z.array(enumOption).min(1).max(100).optional(),
    multiple: z.boolean().default(false),
    format: z
      .enum(["plain", "currency", "percent", "minutes", "rating"])
      .default("plain"),
    target: z.enum(["document", "folder"]).default("document"),
    showWhen: fieldId.optional(),
    validation: fieldValidation.optional(),
    workflow: workflow.optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    // Two display values are honoured for exactly one field type each, and
    // were silently ignored everywhere else: the compiler tests
    // `type === "image" && display === "cover"` and
    // `type === "boolean" && display === "toggle"`. A model asking for a
    // cover on a text field got a plain fact and no explanation.
    //
    // Saying so is the point. A rejected blueprint goes back through the
    // repair loop with the reason; a silently dropped instruction does not.
    if (field.display === "cover" && field.type !== "image") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["display"],
        message: `display "cover" only applies to an image field, and ${field.id} is a ${field.type}.`,
      });
    }
    if (field.display === "toggle" && field.type !== "boolean") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["display"],
        message: `display "toggle" only applies to a boolean field, and ${field.id} is a ${field.type}.`,
      });
    }
  });

const rowSubField = z
  .object({
    id: fieldId,
    label: z.string().trim().min(1).max(160),
    type: z.enum([
      "text",
      "image",
      "date",
      "url",
      "enum",
      "number",
      "boolean",
      "reference",
    ]),
    required: z.boolean().default(false),
    options: z.array(enumOption).min(1).max(100).optional(),
    multiple: z.boolean().default(false),
    format: z
      .enum(["plain", "currency", "percent", "minutes", "rating"])
      .default("plain"),
    target: z.enum(["document", "folder"]).default("document"),
  })
  .strict();

const rowsField = z
  .object({
    id: fieldId,
    label: z.string().trim().min(1).max(160),
    type: z.literal("rows"),
    required: z.boolean().default(false),
    help: z.string().trim().max(500).optional(),
    display: z
      .enum(["auto", "hidden", "checklist", "table", "steps", "timeline", "tiles"])
      .default("auto"),
    fields: z.array(rowSubField).min(1).max(8),
    maxRows: z.number().int().positive().max(500).default(200),
    showWhen: fieldId.optional(),
  })
  .strict();

const computedField = z
  .object({
    id: fieldId,
    label: z.string().trim().min(1).max(160),
    type: z.literal("computed"),
    help: z.string().trim().max(500).optional(),
    display: z.enum(["hidden", "fact", "progress"]).default("fact"),
    format: z
      .enum(["plain", "currency", "percent", "minutes", "rating"])
      .default("plain"),
    showWhen: fieldId.optional(),
    compute: z.discriminatedUnion("op", [
      z.object({ op: z.literal("count"), source: fieldId }).strict(),
      z
        .object({ op: z.literal("sum"), source: fieldId, of: fieldId })
        .strict(),
      z
        .object({ op: z.literal("doneOf"), source: fieldId, of: fieldId })
        .strict(),
      z
        .object({ op: z.literal("ratio"), current: fieldId, target: fieldId })
        .strict(),
    ]),
  })
  .strict();

const itemTypeFieldBlueprintSchema = z.discriminatedUnion("type", [
  scalarField,
  rowsField,
  computedField,
]);

const collectionFilterBlueprint = z
  .object({
    field: fieldId,
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

const collectionSortBlueprint = z
  .object({
    field: z.union([
      z.enum(["createdAt", "updatedAt", "publishedAt", "title"]),
      fieldId,
    ]),
    direction: z.enum(["asc", "desc"]),
  })
  .strict();

const collectionViewBlueprint = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
    name: z.string().trim().min(1).max(80),
    // No "index": the page renderers map list to index and say so, "a list of
    // items and an index of items are the same page" (content.ts). Offering
    // both asked the model to choose between two spellings of one layout.
    // Stored looks still carry either; only the authoring grammar drops one.
    layout: z.enum([
      "list",
      "cards",
      "timeline",
      "single",
      "board",
      "calendar",
      "heatmap",
    ]),
    columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1),
    groupBy: fieldId.optional(),
    dateBy: fieldId.optional(),
    filters: z.array(collectionFilterBlueprint).max(8).optional(),
    sort: z.array(collectionSortBlueprint).max(4).optional(),
  })
  .strict();

export const itemTypeBlueprintSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional(),
    styleReference: z
      .string()
      .trim()
      .max(160)
      .optional()
      .describe("A visual reference such as Medium, Notion, or Apple Notes."),
    fields: z.array(itemTypeFieldBlueprintSchema).max(40).default([]),
    item: z
      .object({
        shape: z.enum(["article", "page", "note", "task", "reference"]).default("page"),
        icon: z.string().trim().min(1).max(8).optional(),
        showBody: z.boolean().default(true),
        showMetadata: z.boolean().default(false),
        showTags: z.boolean().default(false),
      })
      .strict()
      .default({ shape: "page", showBody: true, showMetadata: false, showTags: false }),
    collection: z
      .object({
        layout: z.enum([
          "list",
          "cards",
          "timeline",
          "single",
          "board",
          "calendar",
          "heatmap",
        ]),
        columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1),
        groupBy: fieldId.optional(),
        dateBy: fieldId.optional(),
        summaryFields: z.array(fieldId).max(6).default([]),
        sortBy: z
          .union([
            z.enum(["createdAt", "updatedAt", "publishedAt", "title"]),
            fieldId,
          ])
          .default("updatedAt"),
        sortDirection: z.enum(["asc", "desc"]).default("desc"),
        filters: z.array(collectionFilterBlueprint).max(8).default([]),
        views: z.array(collectionViewBlueprint).max(12).default([]),
        defaultView: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/).optional(),
      })
      .strict(),
    theme: themeTokensSchema.default({}),
  })
  .strict();

export type ItemTypeFieldBlueprint = z.infer<typeof itemTypeFieldBlueprintSchema>;
export type ItemTypeBlueprint = z.infer<typeof itemTypeBlueprintSchema>;

/**
 * Real starting points, not screenshots. Each one is a complete blueprint the
 * writer can use immediately, edit by hand, or refine with AI.
 */
export const ITEM_TYPE_STARTERS: ReadonlyArray<{
  id: string;
  label: string;
  detail: string;
  blueprint: ItemTypeBlueprint;
}> = [
  {
    id: "editorial-publication",
    label: "Editorial publication",
    detail: "A calm reading page and a visual story index",
    blueprint: itemTypeBlueprintSchema.parse({
      name: "Stories",
      description: "Long-form stories with a focused reading experience.",
      styleReference: "Medium",
      fields: [
        { id: "coverImage", label: "Cover image", type: "image", display: "cover" },
        { id: "author", label: "Author", type: "text", display: "auto" },
        { id: "category", label: "Category", type: "enum", options: [
          { value: "ideas", label: "Ideas" },
          { value: "culture", label: "Culture" },
          { value: "work", label: "Work" },
        ], display: "badge" },
        { id: "dek", label: "Dek", type: "text", display: "section" },
        { id: "readingTime", label: "Reading time", type: "number", format: "minutes", display: "auto" },
        { id: "publishedOn", label: "Published", type: "date", display: "auto" },
      ],
      item: { shape: "article", icon: "✦", showBody: true, showMetadata: true, showTags: true },
      collection: {
        layout: "cards",
        columns: 2,
        summaryFields: ["category", "author", "publishedOn"],
        sortBy: "publishedOn",
        sortDirection: "desc",
      },
    }),
  },
  {
    id: "project-board",
    label: "Project board",
    detail: "Notion-style tasks grouped by status",
    blueprint: itemTypeBlueprintSchema.parse({
      name: "Project tasks",
      description: "A clear board for planning and finishing work.",
      styleReference: "Notion",
      fields: [
        { id: "status", label: "Status", type: "enum", options: [
          { value: "not-started", label: "Not started", tone: "neutral" },
          { value: "in-progress", label: "In progress", tone: "info" },
          { value: "done", label: "Done", tone: "success" },
        ], workflow: {
          initial: "not-started",
          completed: ["done"],
          transitions: [
            { from: "not-started", to: "in-progress" },
            { from: "not-started", to: "done" },
            { from: "in-progress", to: "not-started" },
            { from: "in-progress", to: "done" },
            { from: "done", to: "in-progress" },
          ],
        }, display: "badge" },
        { id: "priority", label: "Priority", type: "enum", options: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium", tone: "warning" },
          { value: "high", label: "High", tone: "danger" },
        ], display: "badge" },
        { id: "owner", label: "People", type: "people", multiple: true, display: "badge" },
        { id: "due", label: "Due", type: "date", display: "auto" },
        { id: "complete", label: "Complete", type: "boolean", display: "toggle" },
      ],
      item: { shape: "task", icon: "✓", showBody: true, showMetadata: false, showTags: false },
      collection: {
        layout: "board",
        columns: 3,
        groupBy: "status",
        summaryFields: ["priority", "owner", "due"],
        sortBy: "due",
        sortDirection: "asc",
        defaultView: "board",
        views: [
          {
            id: "board",
            name: "Board",
            layout: "board",
            columns: 3,
            groupBy: "status",
            sort: [{ field: "due", direction: "asc" }],
          },
          {
            id: "open",
            name: "Open tasks",
            layout: "list",
            filters: [{ field: "status", op: "neq", value: "done" }],
            sort: [
              { field: "priority", direction: "desc" },
              { field: "due", direction: "asc" },
            ],
          },
          {
            id: "schedule",
            name: "Schedule",
            layout: "calendar",
            dateBy: "due",
            sort: [{ field: "due", direction: "asc" }],
          },
        ],
      },
    }),
  },
  {
    id: "quick-notes",
    label: "Quick notes",
    detail: "Apple Notes-style pages in a simple list",
    blueprint: itemTypeBlueprintSchema.parse({
      name: "Quick notes",
      description: "Fast private notes with almost no ceremony.",
      styleReference: "Apple Notes",
      fields: [
        { id: "topic", label: "Topic", type: "enum", options: [
          { value: "personal", label: "Personal" },
          { value: "work", label: "Work" },
          { value: "ideas", label: "Ideas" },
        ], display: "badge" },
      ],
      item: { shape: "note", showBody: true, showMetadata: true, showTags: false },
      collection: {
        layout: "list",
        columns: 1,
        summaryFields: ["topic"],
        sortBy: "updatedAt",
        sortDirection: "desc",
      },
    }),
  },
];

function styleDefaults(reference: string | undefined): ThemeTokens {
  const normalized = reference?.trim().toLowerCase() ?? "";
  if (normalized.includes("medium")) {
    return {
      typography: "editorial",
      density: "spacious",
      measure: "reading",
      corners: "subtle",
      surface: "paper",
      titleScale: "large",
      bodyScale: "relaxed",
      alignment: "start",
      media: "contained",
    };
  }
  if (normalized.includes("apple notes") || normalized === "notes") {
    return {
      typography: "system",
      density: "comfortable",
      measure: "reading",
      corners: "subtle",
      surface: "system",
      titleScale: "standard",
      bodyScale: "standard",
      alignment: "start",
      media: "contained",
    };
  }
  if (normalized.includes("notion")) {
    return {
      typography: "system",
      density: "comfortable",
      measure: "wide",
      corners: "subtle",
      surface: "paper",
      titleScale: "large",
      bodyScale: "standard",
      alignment: "start",
      media: "full",
    };
  }
  return {
    typography: "system",
    density: "comfortable",
    measure: "reading",
    corners: "subtle",
    surface: "paper",
    titleScale: "standard",
    bodyScale: "standard",
    alignment: "start",
    media: "contained",
  };
}

function optionValues(field: { options?: Array<{ value: string }> }) {
  return field.options;
}

function exampleTitle(blueprint: ItemTypeBlueprint): string {
  switch (blueprint.item.shape) {
    case "article":
      return "A story worth sharing";
    case "note":
      return "A quick note";
    case "task":
      return "Plan the launch";
    case "reference":
      return "A useful reference";
    case "page":
      return `${blueprint.name} overview`;
  }
}

function scalarDefinition(
  field: Extract<
    ItemTypeFieldBlueprint,
    { type: Exclude<ItemTypeFieldBlueprint["type"], "rows" | "computed"> }
  >,
): DocumentFieldDefinition {
  const base = {
    id: field.id,
    label: field.label,
    required: field.required,
    visibility: field.display === "hidden" ? ("hidden" as const) : ("public" as const),
    ...(field.help ? { help: field.help } : {}),
  };
  switch (field.type) {
    case "text":
    case "date":
    case "url":
    case "boolean":
      return {
        ...base,
        type: field.type,
        ...(field.type === "text" && field.validation?.maxLength
          ? { maxLength: field.validation.maxLength }
          : {}),
      };
    case "richtext":
      return {
        ...base,
        type: "richtext",
        ...(field.validation?.maxLength
          ? { maxLength: field.validation.maxLength }
          : {}),
      };
    case "image":
      return { ...base, type: "image", allowedContentTypes: [] };
    case "enum":
      if (!field.options?.length) {
        throw new Error(`Field ${field.id} needs at least one option.`);
      }
      return {
        ...base,
        type: "enum",
        options: field.options,
        multiple: field.multiple,
        ...(field.workflow
          ? { semantic: "status" as const, workflow: field.workflow }
          : {}),
      };
    case "number":
      return {
        ...base,
        type: "number",
        format: field.format,
        ...(field.validation?.min !== undefined
          ? { min: field.validation.min }
          : {}),
        ...(field.validation?.max !== undefined
          ? { max: field.validation.max }
          : {}),
        ...(field.validation?.step !== undefined
          ? { step: field.validation.step }
          : {}),
      };
    case "reference":
      return {
        ...base,
        type: "reference",
        target: field.target,
        multiple: field.multiple,
        semantic: "relation",
      };
    case "people":
      return {
        ...base,
        type: "reference",
        target: "document",
        multiple: field.multiple,
        semantic: "people",
      };
    case "recurrence":
      return {
        ...base,
        type: "enum",
        options:
          field.options ??
          [
            { value: "none", label: "Does not repeat", tone: "neutral" as const },
            { value: "daily", label: "Daily", tone: "info" as const },
            { value: "weekly", label: "Weekly", tone: "info" as const },
            { value: "monthly", label: "Monthly", tone: "info" as const },
            { value: "yearly", label: "Yearly", tone: "info" as const },
          ],
        multiple: false,
        semantic: "recurrence",
      };
  }
}

function rowDefinition(field: z.infer<typeof rowSubField>) {
  const base = {
    id: field.id,
    label: field.label,
    required: field.required,
    visibility: "public" as const,
  };
  switch (field.type) {
    case "text":
    case "date":
    case "url":
    case "boolean":
      return { ...base, type: field.type };
    case "image":
      return { ...base, type: "image" as const, allowedContentTypes: [] };
    case "enum":
      if (!field.options?.length) {
        throw new Error(`Row field ${field.id} needs at least one option.`);
      }
      return {
        ...base,
        type: "enum" as const,
        options: field.options,
        multiple: field.multiple,
      };
    case "number":
      return { ...base, type: "number" as const, format: field.format };
    case "reference":
      return {
        ...base,
        type: "reference" as const,
        target: field.target,
        multiple: field.multiple,
      };
  }
}

function iconFieldId(blueprint: ItemTypeBlueprint): string | null {
  if (!blueprint.item.icon) return null;
  const used = new Set(blueprint.fields.map((field) => field.id));
  for (const candidate of ["typeIcon", "itemIcon", "templateIcon"]) {
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

function fieldDefinitions(blueprint: ItemTypeBlueprint): DocumentFieldDefinition[] {
  const definitions: DocumentFieldDefinition[] = [];
  for (const field of blueprint.fields) {
    if (field.type === "computed") continue;
    if (field.type !== "rows") {
      definitions.push(scalarDefinition(field));
      continue;
    }
    definitions.push({
        id: field.id,
        label: field.label,
        type: "rows" as const,
        required: field.required,
        visibility: field.display === "hidden" ? "hidden" : "public",
        ...(field.help ? { help: field.help } : {}),
        fields: field.fields.map(rowDefinition),
        maxRows: field.maxRows,
      });
  }
  const iconId = iconFieldId(blueprint);
  if (iconId) {
    definitions.push({
      id: iconId,
      label: "Type icon",
      type: "text",
      required: false,
      visibility: "hidden",
    });
  }
  return definitions;
}

function binding(id: string) {
  return `content.fields.${id}` as const;
}

function conditionBinding(field: { showWhen?: string }) {
  return field.showWhen ? binding(field.showWhen) : undefined;
}

function rowsNode(field: Extract<ItemTypeFieldBlueprint, { type: "rows" }>): RenderNode {
  const boolField = field.fields.find((candidate) => candidate.type === "boolean");
  const labelField = field.fields.find(
    (candidate) => candidate.type === "text" || candidate.type === "url",
  );
  const wantsChecklist = field.display === "checklist" || field.display === "auto";
  if (wantsChecklist && boolField && labelField) {
    return {
      type: "checklist",
      bind: binding(field.id),
      ...(conditionBinding(field) ? { showWhen: conditionBinding(field) } : {}),
      doneBind: `row.${boolField.id}`,
      labelBind: `row.${labelField.id}`,
      meta: field.fields
        .filter((candidate) => candidate.id !== boolField.id && candidate.id !== labelField.id)
        .slice(0, 4)
        .map((candidate) => `row.${candidate.id}`),
      mode: "document",
      sortCheckedLast: true,
      rollup: true,
    };
  }
  const variant =
    field.display === "steps" ||
    field.display === "timeline" ||
    field.display === "tiles" ||
    field.display === "table"
      ? field.display
      : "table";
  return {
    type: "rows",
    bind: binding(field.id),
    ...(conditionBinding(field) ? { showWhen: conditionBinding(field) } : {}),
    variant,
    columns: field.fields.slice(0, 8).map((candidate) => ({
      bind: `row.${candidate.id}`,
      label: candidate.label,
    })),
  };
}

function computedNode(
  field: Extract<ItemTypeFieldBlueprint, { type: "computed" }>,
): RenderNode {
  const showWhen = conditionBinding(field);
  if (field.compute.op === "ratio") {
    return {
      type: "progress",
      variant: field.display === "progress" ? "bar" : "fraction",
      source: {
        currentBind: binding(field.compute.current),
        targetBind: binding(field.compute.target),
      },
      ...(showWhen ? { showWhen } : {}),
    };
  }
  if (field.compute.op === "doneOf" && field.display === "progress") {
    return {
      type: "progress",
      variant: "bar",
      source: {
        checklistBind: binding(field.compute.source),
        doneBind: `row.${field.compute.of}`,
      },
      ...(showWhen ? { showWhen } : {}),
    };
  }
  return {
    type: "facts",
    variant: "strip",
    entries: [
      {
        bind: binding(field.compute.source),
        label: field.label,
        derive:
          field.compute.op === "count"
            ? { op: "count" }
            : field.compute.op === "sum"
              ? { op: "sum", of: `row.${field.compute.of}` }
              : { op: "doneOf", of: `row.${field.compute.of}` },
      },
    ],
    ...(showWhen ? { showWhen } : {}),
  };
}

function fieldNodes(blueprint: ItemTypeBlueprint): RenderNode[] {
  const nodes: RenderNode[] = [];
  const facts: Array<{ bind: string; label?: string }> = [];
  for (const field of blueprint.fields) {
    if (field.display === "hidden" || field.display === "cover") continue;
    const showWhen = conditionBinding(field);
    if (field.type === "computed") {
      nodes.push(computedNode(field));
    } else if (field.type === "rows") {
      nodes.push(rowsNode(field));
    } else if (field.type === "richtext" || field.display === "section") {
      nodes.push({
        type: "prose",
        bind: binding(field.id),
        ...(showWhen ? { showWhen } : {}),
      });
    } else if (field.type === "image") {
      nodes.push({
        type: "image",
        bind: binding(field.id),
        alt: "content.title",
        height: "medium",
        fit: "cover",
        ...(showWhen ? { showWhen } : {}),
      });
    } else if (
      field.type === "enum" ||
      field.type === "recurrence" ||
      field.type === "people" ||
      field.display === "badge"
    ) {
      nodes.push({
        type: "badge",
        bind: binding(field.id),
        variant: field.multiple ? "chips" : "pill",
        showIcon: true,
        ...(showWhen ? { showWhen } : {}),
      });
    } else if (field.type === "boolean" && field.display === "toggle") {
      nodes.push({
        type: "toggle",
        bind: binding(field.id),
        variant: "circle",
        ...(showWhen ? { showWhen } : {}),
      });
    } else if (showWhen) {
      nodes.push({
        type: "facts",
        variant: "strip",
        entries: [{ bind: binding(field.id), label: field.label }],
        showWhen,
      });
    } else {
      facts.push({ bind: binding(field.id), label: field.label });
    }
  }
  if (facts.length > 0) {
    nodes.unshift({ type: "facts", variant: "strip", entries: facts.slice(0, 12) });
  }
  return nodes;
}

function headerNode(blueprint: ItemTypeBlueprint): RenderNode {
  const children: RenderNode[] = [];
  const iconId = iconFieldId(blueprint);
  if (iconId && blueprint.item.icon) {
    children.push({
      type: "text",
      bind: binding(iconId),
      role: "icon",
      fallback: blueprint.item.icon,
    });
  }
  children.push({
    type: "text",
    bind: "content.title",
    role: "title",
    fallback: "Untitled",
  });
  children.push({
    type: "text",
    bind: "content.subtitle",
    role: "subtitle",
    showWhen: "content.subtitle",
  });
  if (blueprint.item.showTags) {
    children.push({ type: "badge", bind: "content.tags", variant: "chips", showIcon: false });
  }
  if (blueprint.item.showMetadata) {
    children.push(blueprint.item.shape === "article" ? { type: "byline" } : { type: "metadata" });
  }
  return {
    type: blueprint.item.shape === "article" ? "masthead" : "group",
    gap: "sm",
    children,
  };
}

function itemTree(blueprint: ItemTypeBlueprint): RenderNode {
  const children: RenderNode[] = [];
  const cover = blueprint.fields.find(
    (field) => field.type === "image" && field.display === "cover",
  );
  const header = headerNode(blueprint);
  if (cover && blueprint.item.shape === "page") {
    children.push({
      type: "cover",
      bind: binding(cover.id),
      alt: "content.title",
      height: "large",
      fit: "cover",
    });
  }
  if (blueprint.item.shape === "note" && blueprint.item.showMetadata) {
    children.push({ type: "metadata" });
  }
  children.push(header);
  if (cover && blueprint.item.shape !== "page") {
    children.push({
      type: "cover",
      bind: binding(cover.id),
      alt: "content.title",
      height: "large",
      fit: "cover",
    });
  }
  children.push(...fieldNodes(blueprint));
  if (blueprint.item.showBody) {
    children.push({ type: "prose", bind: "content.body" });
  }
  return { type: "stack", gap: "lg", children };
}

function summaryNodes(blueprint: ItemTypeBlueprint): RenderNode[] {
  const requested =
    blueprint.collection.summaryFields.length > 0
      ? blueprint.collection.summaryFields
      : blueprint.fields
          .filter((field) => !["image", "richtext", "rows"].includes(field.type))
          .slice(0, 3)
          .map((field) => field.id);
  const fields = requested
    .map((id) => blueprint.fields.find((field) => field.id === id))
    .filter((field): field is ItemTypeFieldBlueprint => Boolean(field));
  const nodes: RenderNode[] = [];
  const facts: Array<{ bind: string; label?: string }> = [];
  for (const field of fields) {
    if (field.type === "computed") {
      if (field.display !== "hidden") nodes.push(computedNode(field));
      continue;
    }
    if (field.type === "rows" || field.type === "richtext" || field.type === "image") continue;
    const showWhen = conditionBinding(field);
    if (field.type === "enum" || field.type === "recurrence" || field.type === "people") {
      nodes.push({
        type: "badge",
        bind: binding(field.id),
        variant: field.multiple ? "chips" : "pill",
        showIcon: true,
        ...(showWhen ? { showWhen } : {}),
      });
    } else if (field.type === "boolean" && field.display === "toggle") {
      nodes.push({
        type: "toggle",
        bind: binding(field.id),
        labelBind: "content.title",
        variant: "circle",
        ...(showWhen ? { showWhen } : {}),
      });
    } else if (showWhen) {
      nodes.push({
        type: "facts",
        variant: "pills",
        entries: [{ bind: binding(field.id), label: field.label }],
        showWhen,
      });
    } else {
      facts.push({ bind: binding(field.id), label: field.label });
    }
  }
  if (facts.length > 0) nodes.push({ type: "facts", variant: "pills", entries: facts });
  return nodes;
}

function collectionItemTree(blueprint: ItemTypeBlueprint): RenderNode {
  const children: RenderNode[] = [];
  const cover = blueprint.fields.find(
    (field) => field.type === "image" && field.display === "cover",
  );
  if (cover) {
    children.push({
      type: "cover",
      bind: binding(cover.id),
      alt: "content.title",
      height: "compact",
      fit: "cover",
    });
  }
  const doneField = blueprint.fields.find(
    (field) => field.type === "boolean" && field.display === "toggle",
  );
  if (blueprint.item.shape === "task" && doneField && doneField.type !== "rows") {
    children.push({
      type: "stack",
      direction: "horizontal",
      gap: "sm",
      align: "center",
      children: [
        {
          type: "toggle",
          bind: binding(doneField.id),
          variant: "circle",
        },
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled",
        },
      ],
    });
  } else {
    children.push({
      type: "text",
      bind: "content.title",
      role: "heading",
      fallback: "Untitled",
    });
  }
  children.push({
    type: "text",
    bind: "content.subtitle",
    role: "caption",
    showWhen: "content.subtitle",
  });
  children.push(...summaryNodes(blueprint));
  if (blueprint.collection.layout === "timeline") children.push({ type: "metadata" });
  return { type: "stack", gap: "sm", children };
}

function exampleScalar(
  field: Extract<
    ItemTypeFieldBlueprint,
    { type: Exclude<ItemTypeFieldBlueprint["type"], "rows" | "computed"> }
  >,
) {
  switch (field.type) {
    case "text":
      return `Example ${field.label.toLowerCase()}`;
    case "richtext":
      return `A short example of ${field.label.toLowerCase()}.`;
    case "image":
      return null;
    case "date":
      return "2026-08-19";
    case "url":
      return "https://example.com";
    case "enum":
      return field.multiple
        ? field.options?.slice(0, 2).map((option) => option.value) ?? []
        : field.options?.[0]?.value ?? null;
    case "number":
      return field.format === "percent" ? 0.72 : field.format === "rating" ? 4 : 3;
    case "boolean":
      return false;
    case "reference":
      return field.multiple ? ["Example item"] : "Example item";
    case "people":
      return field.multiple ? ["Alex Morgan", "Sam Lee"] : "Alex Morgan";
    case "recurrence":
      return field.options?.[0]?.value ?? "weekly";
  }
}

function exampleRows(field: Extract<ItemTypeFieldBlueprint, { type: "rows" }>) {
  return ["First", "Second"].map((prefix, index) =>
    Object.fromEntries(
      field.fields.map((sub) => {
        if (sub.type === "boolean") return [sub.id, index === 1];
        if (sub.type === "number") return [sub.id, index + 1];
        if (sub.type === "date") return [sub.id, `2026-08-${String(19 + index).padStart(2, "0")}`];
        if (sub.type === "enum") return [sub.id, optionValues(sub)?.[index]?.value ?? optionValues(sub)?.[0]?.value ?? ""];
        if (sub.type === "url") return [sub.id, "https://example.com"];
        return [sub.id, `${prefix} ${sub.label.toLowerCase()}`];
      }),
    ),
  );
}

/**
 * What was changed to make a blueprint compile, and why.
 *
 * Reported rather than silent: a person who asked for a year grid and got a
 * dated list is owed the sentence explaining it. Silence here would be the
 * worse half of the old behaviour, not the better half.
 */
type BlueprintAdjustment = { change: string; reason: string };

/** Layouts that cannot render without a field of a particular kind. */
const LAYOUT_NEEDS = {
  board: "enum",
  calendar: "date",
  heatmap: "date",
} as const;

/**
 * Bring a collection into range of the fields it actually has.
 *
 * A layout with a hard requirement used to throw, and the model, asked to
 * repair, would usually drop the layout AND the fields and hand back a type
 * with nothing in it: a request to track runs as a year grid produced a look
 * with no fields at all and an index that errored. An empty page is a worse
 * answer than a dated list, so this reaches for the field the layout needs,
 * and falls back to a layout the fields can support when there is none.
 *
 * Only ever loosens. A blueprint that already validates comes back untouched.
 */
export function adaptCollectionToFields(
  blueprint: ItemTypeBlueprint,
): { blueprint: ItemTypeBlueprint; adjustments: BlueprintAdjustment[] } {
  const adjustments: BlueprintAdjustment[] = [];
  const stored = blueprint.fields.filter((field) => field.type !== "computed");
  const byId = new Map(stored.map((field) => [field.id, field] as const));
  const firstDate = stored.find((field) => field.type === "date");
  const firstSingleEnum = stored.find(
    (field) => field.type === "enum" && !field.multiple,
  );

  const adapt = <T extends {
    layout: ItemTypeBlueprint["collection"]["layout"];
    groupBy?: string;
    dateBy?: string;
  }>(collection: T, where: string): T => {
    let next = { ...collection };

    // A pointer at a field that is missing or of the wrong kind is dropped
    // before anything else, so the layout rules below see the truth.
    if (next.groupBy) {
      const grouped = byId.get(next.groupBy);
      if (!grouped || grouped.type !== "enum" || grouped.multiple) {
        adjustments.push({
          change: `${where}: ignored grouping by ${next.groupBy}`,
          reason: "grouping needs a single-select field, and that one is not",
        });
        next = { ...next, groupBy: undefined };
      }
    }
    if (next.dateBy) {
      const dated = byId.get(next.dateBy);
      if (!dated || dated.type !== "date") {
        adjustments.push({
          change: `${where}: ignored date placement by ${next.dateBy}`,
          reason: "placing items on days needs a date field, and that one is not",
        });
        next = { ...next, dateBy: undefined };
      }
    }

    const needs = LAYOUT_NEEDS[next.layout as keyof typeof LAYOUT_NEEDS];
    if (!needs) return next;
    if (needs === "date" && !next.dateBy) {
      if (firstDate) {
        adjustments.push({
          change: `${where}: placed items by ${firstDate.id}`,
          reason: `a ${next.layout} needs a date field and none was named`,
        });
        next = { ...next, dateBy: firstDate.id };
      } else {
        adjustments.push({
          change: `${where}: showed a list instead of a ${next.layout}`,
          reason: "there is no date field to place items on",
        });
        next = { ...next, layout: "list" as T["layout"] };
      }
    }
    if (needs === "enum" && !next.groupBy) {
      if (firstSingleEnum) {
        adjustments.push({
          change: `${where}: grouped by ${firstSingleEnum.id}`,
          reason: "a board needs a single-select field and none was named",
        });
        next = { ...next, groupBy: firstSingleEnum.id };
      } else {
        adjustments.push({
          change: `${where}: showed a list instead of a board`,
          reason: "there is no single-select field to make columns from",
        });
        next = { ...next, layout: "list" as T["layout"] };
      }
    }
    return next;
  };

  const collection = {
    ...adapt(blueprint.collection, "Folder view"),
    views: blueprint.collection.views.map((view) =>
      adapt(view, `View "${view.name}"`),
    ),
  };
  return {
    blueprint: { ...blueprint, collection },
    adjustments,
  };
}

export function compileItemTypeBlueprint(
  value: unknown,
  identity: { id: string; version?: number },
): TemplateDefinition {
  // Loosened before validation, so a layout the fields cannot support becomes
  // the nearest thing they can rather than an error the model answers with an
  // empty type.
  const { blueprint } = adaptCollectionToFields(
    itemTypeBlueprintSchema.parse(value),
  );
  const fieldMap = new Map(blueprint.fields.map((field) => [field.id, field]));
  if (fieldMap.size !== blueprint.fields.length) {
    throw new Error("Item type field ids must be unique.");
  }
  const storedFieldMap = new Map(
    blueprint.fields
      .filter((field) => field.type !== "computed")
      .map((field) => [field.id, field] as const),
  );
  const requireStoredField = (id: string, context: string) => {
    const field = storedFieldMap.get(id);
    if (!field) throw new Error(`${context} field ${id} is not declared or is computed.`);
    return field;
  };
  for (const field of blueprint.fields) {
    if (field.showWhen) {
      if (field.showWhen === field.id) {
        throw new Error(`Field ${field.id} cannot conditionally show itself.`);
      }
      const condition = requireStoredField(field.showWhen, `Visibility for ${field.id}`);
      if (condition.type !== "boolean" && condition.type !== "enum") {
        throw new Error(`Visibility for ${field.id} needs a boolean or enum field.`);
      }
    }
    if (field.type === "rows") {
      if (new Set(field.fields.map((sub) => sub.id)).size !== field.fields.length) {
        throw new Error(`Rows field ${field.id} has duplicate sub-field ids.`);
      }
      continue;
    }
    if (field.type === "computed") {
      if (field.compute.op === "ratio") {
        const current = requireStoredField(field.compute.current, `Computed field ${field.id}`);
        const target = requireStoredField(field.compute.target, `Computed field ${field.id}`);
        if (current.type !== "number" || target.type !== "number") {
          throw new Error(`Computed ratio ${field.id} needs two number fields.`);
        }
      } else {
        const compute = field.compute;
        const source = requireStoredField(compute.source, `Computed field ${field.id}`);
        if (source.type !== "rows") {
          throw new Error(`Computed ${compute.op} ${field.id} needs a rows source.`);
        }
        if (compute.op !== "count") {
          const sub = source.fields.find((candidate) => candidate.id === compute.of);
          const expected = compute.op === "sum" ? "number" : "boolean";
          if (!sub || sub.type !== expected) {
            throw new Error(
              `Computed ${compute.op} ${field.id} needs a ${expected} row sub-field.`,
            );
          }
        }
      }
      continue;
    }
    if (field.workflow && field.type !== "enum") {
      throw new Error(`Workflow field ${field.id} must be an enum.`);
    }
    if (field.type === "recurrence" && field.multiple) {
      throw new Error(`Recurrence field ${field.id} must be single-select.`);
    }
    if (field.validation) {
      const keys = Object.keys(field.validation);
      if (field.type === "text" || field.type === "richtext") {
        if (keys.some((key) => key !== "maxLength")) {
          throw new Error(`Text validation for ${field.id} only supports maxLength.`);
        }
        if (field.type === "text" && (field.validation.maxLength ?? 0) > 2_000_000) {
          throw new Error(`Text field ${field.id} maxLength exceeds 2000000.`);
        }
      } else if (field.type === "number") {
        if (keys.some((key) => !["min", "max", "step"].includes(key))) {
          throw new Error(`Number validation for ${field.id} only supports min, max, and step.`);
        }
        if (
          field.validation.min !== undefined &&
          field.validation.max !== undefined &&
          field.validation.min > field.validation.max
        ) {
          throw new Error(`Number field ${field.id} has min greater than max.`);
        }
      } else {
        throw new Error(`Field ${field.id} does not support validation constraints.`);
      }
    }
  }
  if (new Set(blueprint.collection.summaryFields).size !== blueprint.collection.summaryFields.length) {
    throw new Error("Summary fields must be unique.");
  }
  for (const id of blueprint.collection.summaryFields) {
    if (!fieldMap.has(id)) throw new Error(`Summary field ${id} is not declared.`);
  }
  const validateFilter = (
    filter: z.infer<typeof collectionFilterBlueprint>,
    context: string,
  ) => {
    const field = requireStoredField(filter.field, context);
    if (filter.op === "contains" && field.type !== "text" && field.type !== "richtext") {
      throw new Error(`${context} contains filter needs a text field.`);
    }
    if (
      ["gt", "gte", "lt", "lte"].includes(filter.op) &&
      field.type !== "number" &&
      field.type !== "date"
    ) {
      throw new Error(`${context} comparison filter needs a number or date field.`);
    }
  };
  const validateCollectionShape = (
    collection: {
      layout: ItemTypeBlueprint["collection"]["layout"];
      groupBy?: string;
      dateBy?: string;
      filters?: readonly z.infer<typeof collectionFilterBlueprint>[];
      sort?: readonly z.infer<typeof collectionSortBlueprint>[];
    },
    context: string,
  ) => {
    if (collection.groupBy) {
      const grouped = storedFieldMap.get(collection.groupBy);
      if (!grouped || grouped.type !== "enum" || grouped.multiple) {
        throw new Error(`${context} grouping needs a single-select field.`);
      }
    }
    if (collection.layout === "board" && !collection.groupBy) {
      throw new Error(
        context === "Collection"
          ? "A board needs a groupBy field."
          : `${context} board needs a groupBy field.`,
      );
    }
    if (collection.dateBy) {
      const dated = storedFieldMap.get(collection.dateBy);
      if (!dated || dated.type !== "date") {
        throw new Error(`${context} placement needs a date field.`);
      }
    }
    if (["calendar", "heatmap"].includes(collection.layout) && !collection.dateBy) {
      throw new Error(
        context === "Collection"
          ? `A ${collection.layout} needs a dateBy field.`
          : `${context} ${collection.layout} needs a dateBy field.`,
      );
    }
    for (const filter of collection.filters ?? []) validateFilter(filter, context);
    for (const sort of collection.sort ?? []) {
      if (
        !["createdAt", "updatedAt", "publishedAt", "title"].includes(sort.field)
      ) {
        requireStoredField(sort.field, `${context} sort`);
      }
    }
  };
  validateCollectionShape(
    {
      ...blueprint.collection,
      sort: [
        {
          field: blueprint.collection.sortBy,
          direction: blueprint.collection.sortDirection,
        },
      ],
    },
    "Collection",
  );
  const viewIds = new Set<string>();
  for (const view of blueprint.collection.views) {
    if (viewIds.has(view.id)) throw new Error(`Collection view id ${view.id} is duplicated.`);
    viewIds.add(view.id);
    validateCollectionShape(view, `Collection view ${view.name}`);
  }
  if (blueprint.collection.defaultView && !viewIds.has(blueprint.collection.defaultView)) {
    throw new Error(`Default view ${blueprint.collection.defaultView} is not declared.`);
  }
  const exampleFields = Object.fromEntries(
    blueprint.fields
      .filter((field) => field.type !== "computed")
      .map((field) => [
        field.id,
        field.type === "rows" ? exampleRows(field) : exampleScalar(field),
      ] as const)
      .filter(([, example]) => example !== null),
  );
  const iconId = iconFieldId(blueprint);
  if (iconId && blueprint.item.icon) exampleFields[iconId] = blueprint.item.icon;
  const theme = { ...styleDefaults(blueprint.styleReference), ...blueprint.theme };
  const compileSort = (
    sort: readonly z.infer<typeof collectionSortBlueprint>[],
  ) =>
    sort.map((entry) => ({
      field: ["createdAt", "updatedAt", "publishedAt", "title"].includes(entry.field)
        ? entry.field
        : binding(entry.field),
      direction: entry.direction,
    }));
  const compileFilters = (
    filters: readonly z.infer<typeof collectionFilterBlueprint>[],
  ) => filters.map((filter) => ({ ...filter, field: binding(filter.field) }));
  const baseSort = compileSort([
    {
      field: blueprint.collection.sortBy,
      direction: blueprint.collection.sortDirection,
    },
  ]);
  const baseFilters = compileFilters(blueprint.collection.filters);
  const compiledViews = blueprint.collection.views.map((view) => ({
    id: view.id,
    name: view.name,
    layout: view.layout,
    columns: view.columns,
    ...(view.groupBy ? { groupBy: binding(view.groupBy) } : {}),
    ...(view.dateBy ? { dateBy: binding(view.dateBy) } : {}),
    sort: view.sort ? compileSort(view.sort) : baseSort,
    filters: view.filters ? compileFilters(view.filters) : baseFilters,
  }));
  const defaultView = blueprint.collection.defaultView
    ? compiledViews.find((view) => view.id === blueprint.collection.defaultView)
    : undefined;

  return validateTemplateDefinition({
    schemaVersion: 1,
    engineVersion: 1,
    id: identity.id,
    version: identity.version ?? 1,
    name: blueprint.name,
    description:
      blueprint.description ??
      (blueprint.styleReference
        ? `${blueprint.name}, inspired by ${blueprint.styleReference}.`
        : blueprint.name),
    fields: fieldDefinitions(blueprint),
    theme,
    item: itemTree(blueprint),
    collection: {
      layout: defaultView?.layout ?? blueprint.collection.layout,
      columns: defaultView?.columns ?? blueprint.collection.columns,
      gap: theme.density === "compact" ? "sm" : "md",
      ...(defaultView?.groupBy ?? blueprint.collection.groupBy
        ? {
            groupBy:
              defaultView?.groupBy ?? binding(blueprint.collection.groupBy!),
          }
        : {}),
      ...(defaultView?.dateBy ?? blueprint.collection.dateBy
        ? {
            dateBy:
              defaultView?.dateBy ?? binding(blueprint.collection.dateBy!),
          }
        : {}),
      sort: defaultView?.sort ?? baseSort,
      filters: defaultView?.filters ?? baseFilters,
      views: compiledViews,
      ...(blueprint.collection.defaultView
        ? { defaultView: blueprint.collection.defaultView }
        : {}),
      item: collectionItemTree(blueprint),
    },
    example: {
      title: exampleTitle(blueprint),
      subtitle: blueprint.description ?? `An example of ${blueprint.name.toLowerCase()}.`,
      body: blueprint.item.showBody
        ? "Start writing here. The page and its collection view share one reusable look."
        : "",
      fields: exampleFields,
      tags: blueprint.item.showTags ? ["Example"] : [],
    },
  });
}
