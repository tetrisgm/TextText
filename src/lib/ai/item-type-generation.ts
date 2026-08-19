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
      "type": "text" | "richtext" | "image" | "date" | "url" | "enum" | "number" | "boolean" | "reference" | "people" | "recurrence",
      "display": "auto" | "hidden" | "cover" | "fact" | "badge" | "toggle" | "section",
      "options": [{ "value": string, "label": string, "tone": "neutral" | "info" | "success" | "warning" | "danger" | "accent" }],
      "multiple": boolean,
      "showWhen": boolean or enum field id,
      "validation": { "maxLength": number } for text or { "min": number, "max": number, "step": number } for numbers,
      "workflow": { "initial": option value, "completed": [option values], "transitions": [{ "from": option value, "to": option value }] } for status enums
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
    },
    {
      "id": camelCase string,
      "label": string,
      "type": "computed",
      "display": "fact" | "progress" | "hidden",
      "compute":
        { "op": "count", "source": rows field id } |
        { "op": "sum", "source": rows field id, "of": numeric row sub-field id } |
        { "op": "doneOf", "source": rows field id, "of": boolean row sub-field id } |
        { "op": "ratio", "current": number field id, "target": number field id }
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
    "dateBy": field id when layout is calendar or heatmap,
    "summaryFields": [field ids],
    "sortBy": "createdAt" | "updatedAt" | "publishedAt" | "title" | field id,
    "sortDirection": "asc" | "desc",
    "filters": [{ "field": field id, "op": "eq" | "neq" | "isSet" | "notSet" | "gt" | "gte" | "lt" | "lte" | "contains", "value": string | number | boolean }],
    "views": [{
      "id": lowercase-hyphen id,
      "name": string,
      "layout": folder layout,
      "columns": 1 | 2 | 3 | 4,
      "groupBy": field id,
      "dateBy": field id,
      "filters": [filters],
      "sort": [{ "field": system key or field id, "direction": "asc" | "desc" }]
    }],
    "defaultView": view id
  },
  "theme": {}
}
Omit properties that do not apply. Enum fields must include options. Reference fields create relations to other documents or folders. People fields link ordinary TextText people records without introducing a separate account model. Recurrence fields use safe preset enum values. Computed fields are read-only display values and never create stored document fields.`;

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
