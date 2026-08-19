import {
  itemTypeBlueprintSchema,
  type ItemTypeBlueprint,
} from "@/lib/presentation/item-type-blueprint";

export const ITEM_TYPE_BLUEPRINT_FORMAT = `Return JSON only, with this shape:
{
  "name": string,
  "description": string,
  "styleReference": string,
  "audience": "private" | "publishable",
  "fields": [
    {
      "id": camelCase string,
      "label": string,
      "type": "text" | "richtext" | "image" | "date" | "url" | "enum" | "number" | "boolean" | "reference",
      "display": "auto" | "hidden" | "cover" | "fact" | "badge" | "toggle" | "section",
      "options": [{ "value": string, "label": string, "tone": "neutral" | "info" | "success" | "warning" | "danger" | "accent" }]
    },
    {
      "id": camelCase string,
      "label": string,
      "type": "rows",
      "display": "checklist" | "table" | "steps" | "timeline" | "tiles",
      "fields": [
        { "id": "done", "label": "Done", "type": "boolean" },
        { "id": "text", "label": "Item", "type": "text" }
      ]
    }
  ],
  "item": {
    "shape": "article" | "page" | "note" | "task" | "reference",
    "showBody": boolean,
    "showMetadata": boolean,
    "showTags": boolean
  },
  "collection": {
    "layout": "list" | "cards" | "timeline" | "index" | "single" | "board" | "calendar" | "heatmap",
    "columns": 1 | 2 | 3 | 4,
    "groupBy": field id when layout is board,
    "dateBy": field id when layout is calendar,
    "summaryFields": [field ids],
    "sortBy": "createdAt" | "updatedAt" | "publishedAt" | "title" | field id,
    "sortDirection": "asc" | "desc"
  },
  "theme": {}
}
Omit properties that do not apply. Enum fields must include options.`;

export function parseItemTypeBlueprintText(text: string): ItemTypeBlueprint {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  const candidate =
    first >= 0 && last > first ? unfenced.slice(first, last + 1) : unfenced;
  return itemTypeBlueprintSchema.parse(JSON.parse(candidate));
}

export function honorNamedStyleReference(
  blueprint: ItemTypeBlueprint,
  request: string,
): ItemTypeBlueprint {
  const named = ["Apple Notes", "Medium", "Notion"].find((reference) =>
    request.toLowerCase().includes(reference.toLowerCase()),
  );
  if (!named || blueprint.styleReference?.toLowerCase().includes(named.toLowerCase())) {
    return blueprint;
  }
  return itemTypeBlueprintSchema.parse({
    ...blueprint,
    styleReference: blueprint.styleReference
      ? `${named}: ${blueprint.styleReference}`.slice(0, 160)
      : named,
  });
}

export function itemTypeBlueprintRepairPrompt({
  error,
  generated,
  request,
}: {
  error: unknown;
  generated: string;
  request: string;
}): string {
  const validation =
    error instanceof Error ? error.message.slice(0, 4_000) : "Invalid blueprint";
  return `Correct the generated JSON so it validates as the requested item type.

Original request:
${request}

Generated JSON:
${generated.slice(0, 20_000)}

Validation problem:
${validation}

${ITEM_TYPE_BLUEPRINT_FORMAT}`;
}
