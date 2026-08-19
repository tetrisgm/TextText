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
    ]),
    required: z.boolean().default(false),
    help: z.string().trim().max(500).optional(),
    display: z
      .enum(["auto", "hidden", "cover", "fact", "badge", "toggle", "section"])
      .default("auto"),
    options: z.array(enumOption).min(1).max(100).optional(),
    multiple: z.boolean().default(false),
    format: z
      .enum(["plain", "currency", "percent", "minutes", "rating"])
      .default("plain"),
    target: z.enum(["document", "folder"]).default("document"),
  })
  .strict();

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
  })
  .strict();

export const itemTypeFieldBlueprintSchema = z.discriminatedUnion("type", [
  scalarField,
  rowsField,
]);

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
    audience: z.enum(["private", "publishable"]).default("private"),
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
          "index",
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
      audience: "publishable",
      fields: [
        { id: "category", label: "Category", type: "enum", options: [
          { value: "ideas", label: "Ideas" },
          { value: "culture", label: "Culture" },
          { value: "work", label: "Work" },
        ], display: "badge" },
        { id: "dek", label: "Dek", type: "text", display: "section" },
        { id: "publishedOn", label: "Published", type: "date", display: "fact" },
      ],
      item: { shape: "article", icon: "✦", showBody: true, showMetadata: true, showTags: true },
      collection: {
        layout: "cards",
        columns: 2,
        summaryFields: ["category", "publishedOn"],
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
      audience: "private",
      fields: [
        { id: "status", label: "Status", type: "enum", options: [
          { value: "not-started", label: "Not started", tone: "neutral" },
          { value: "in-progress", label: "In progress", tone: "info" },
          { value: "done", label: "Done", tone: "success" },
        ], display: "badge" },
        { id: "priority", label: "Priority", type: "enum", options: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium", tone: "warning" },
          { value: "high", label: "High", tone: "danger" },
        ], display: "badge" },
        { id: "due", label: "Due", type: "date", display: "fact" },
        { id: "complete", label: "Complete", type: "boolean", display: "toggle" },
      ],
      item: { shape: "task", icon: "✓", showBody: true, showMetadata: false, showTags: false },
      collection: {
        layout: "board",
        columns: 3,
        groupBy: "status",
        summaryFields: ["priority", "due"],
        sortBy: "due",
        sortDirection: "asc",
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
      audience: "private",
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

function scalarDefinition(
  field: Extract<ItemTypeFieldBlueprint, { type: Exclude<ItemTypeFieldBlueprint["type"], "rows"> }>,
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
    case "richtext":
    case "date":
    case "url":
    case "boolean":
      return { ...base, type: field.type };
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
      };
    case "number":
      return { ...base, type: "number", format: field.format };
    case "reference":
      return {
        ...base,
        type: "reference",
        target: field.target,
        multiple: field.multiple,
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
  const definitions = blueprint.fields.map<DocumentFieldDefinition>((field) => {
    if (field.type !== "rows") return scalarDefinition(field);
    return {
      id: field.id,
      label: field.label,
      type: "rows" as const,
      required: field.required,
      visibility: field.display === "hidden" ? "hidden" : "public",
      ...(field.help ? { help: field.help } : {}),
      fields: field.fields.map(rowDefinition),
      maxRows: field.maxRows,
    };
  });
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
    variant,
    columns: field.fields.slice(0, 8).map((candidate) => ({
      bind: `row.${candidate.id}`,
      label: candidate.label,
    })),
  };
}

function fieldNodes(blueprint: ItemTypeBlueprint): RenderNode[] {
  const nodes: RenderNode[] = [];
  const facts: Array<{ bind: string; label?: string }> = [];
  for (const field of blueprint.fields) {
    if (field.display === "hidden" || field.display === "cover") continue;
    if (field.type === "rows") {
      nodes.push(rowsNode(field));
    } else if (field.type === "richtext" || field.display === "section") {
      nodes.push({ type: "prose", bind: binding(field.id) });
    } else if (field.type === "image") {
      nodes.push({
        type: "image",
        bind: binding(field.id),
        alt: "content.title",
        height: "medium",
        fit: "cover",
      });
    } else if (field.type === "enum" || field.display === "badge") {
      nodes.push({ type: "badge", bind: binding(field.id), variant: "pill", showIcon: true });
    } else if (field.type === "boolean" || field.display === "toggle") {
      nodes.push({ type: "toggle", bind: binding(field.id), variant: "circle" });
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
    if (field.type === "rows" || field.type === "richtext" || field.type === "image") continue;
    if (field.type === "enum") {
      nodes.push({ type: "badge", bind: binding(field.id), variant: "pill", showIcon: true });
    } else if (field.type === "boolean") {
      nodes.push({
        type: "toggle",
        bind: binding(field.id),
        labelBind: "content.title",
        variant: "circle",
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
  const doneField = blueprint.fields.find((field) => field.type === "boolean");
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

function exampleScalar(field: Extract<ItemTypeFieldBlueprint, { type: Exclude<ItemTypeFieldBlueprint["type"], "rows"> }>) {
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

export function compileItemTypeBlueprint(
  value: unknown,
  identity: { id: string; version?: number },
): TemplateDefinition {
  const blueprint = itemTypeBlueprintSchema.parse(value);
  const fieldMap = new Map(blueprint.fields.map((field) => [field.id, field]));
  for (const id of blueprint.collection.summaryFields) {
    if (!fieldMap.has(id)) throw new Error(`Summary field ${id} is not declared.`);
  }
  if (blueprint.collection.groupBy) {
    const grouped = fieldMap.get(blueprint.collection.groupBy);
    if (!grouped || grouped.type !== "enum" || grouped.multiple) {
      throw new Error("Board grouping needs a single-select field.");
    }
  }
  if (blueprint.collection.layout === "board" && !blueprint.collection.groupBy) {
    throw new Error("A board needs a groupBy field.");
  }
  if (blueprint.collection.dateBy) {
    const dated = fieldMap.get(blueprint.collection.dateBy);
    if (!dated || dated.type !== "date") {
      throw new Error("Calendar placement needs a date field.");
    }
  }
  if (blueprint.collection.layout === "calendar" && !blueprint.collection.dateBy) {
    throw new Error("A calendar needs a dateBy field.");
  }
  if (
    !["createdAt", "updatedAt", "publishedAt", "title"].includes(
      blueprint.collection.sortBy,
    ) &&
    !fieldMap.has(blueprint.collection.sortBy)
  ) {
    throw new Error(`Sort field ${blueprint.collection.sortBy} is not declared.`);
  }

  const exampleFields = Object.fromEntries(
    blueprint.fields
      .map((field) => [
        field.id,
        field.type === "rows" ? exampleRows(field) : exampleScalar(field),
      ] as const)
      .filter(([, example]) => example !== null),
  );
  const iconId = iconFieldId(blueprint);
  if (iconId && blueprint.item.icon) exampleFields[iconId] = blueprint.item.icon;
  const theme = { ...styleDefaults(blueprint.styleReference), ...blueprint.theme };
  const sortField = ["createdAt", "updatedAt", "publishedAt", "title"].includes(
    blueprint.collection.sortBy,
  )
    ? blueprint.collection.sortBy
    : binding(blueprint.collection.sortBy);

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
    capabilities: [
      "assets",
      "collaboration",
      "comments",
      "search",
      ...(blueprint.audience === "publishable" ? (["publish"] as const) : []),
    ],
    theme,
    item: itemTree(blueprint),
    collection: {
      layout: blueprint.collection.layout,
      columns: blueprint.collection.columns,
      gap: theme.density === "compact" ? "sm" : "md",
      ...(blueprint.collection.groupBy
        ? { groupBy: binding(blueprint.collection.groupBy) }
        : {}),
      ...(blueprint.collection.dateBy
        ? { dateBy: binding(blueprint.collection.dateBy) }
        : {}),
      sort: [{ field: sortField, direction: blueprint.collection.sortDirection }],
      filters: [],
      item: collectionItemTree(blueprint),
    },
    example: {
      title: blueprint.item.shape === "task" ? "Plan the launch" : `A ${blueprint.name.toLowerCase()} example`,
      subtitle: blueprint.description ?? `An example of ${blueprint.name.toLowerCase()}.`,
      body: blueprint.item.showBody
        ? "Start writing here. The page and its collection view share one reusable look."
        : "",
      fields: exampleFields,
      tags: blueprint.item.showTags ? ["Example"] : [],
    },
  });
}
