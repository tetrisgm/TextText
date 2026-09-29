import {
  compileItemTypeBlueprint,
  itemTypeBlueprintSchema,
  type ItemTypeBlueprint,
} from "@/lib/presentation/item-type-blueprint";
import {
  ITEM_TYPE_BLUEPRINT_FORMAT,
  honorNamedStyleReference,
} from "@/lib/ai/item-type-generation";
import { assertCompatibleItemTypeFields } from "@/lib/presentation/item-type-update";
import { assessItemTypeQuality } from "@/lib/presentation/item-type-quality";

function validateNativeBlueprint(
  value: unknown,
  request: string,
  current?: ItemTypeBlueprint,
  preserveFields = true,
): ItemTypeBlueprint {
  const blueprint = honorNamedStyleReference(
    itemTypeBlueprintSchema.parse(value),
    request,
  );
  const review = assessItemTypeQuality(blueprint);
  if (!review.passes) {
    throw new Error(
      `Improve the item type and return a corrected blueprint: ${review.findings
        .map((finding) => finding.message)
        .join(" ")}`,
    );
  }
  try {
    // Shape validation cannot prove cross-field relationships such as unique
    // ids, valid computed sources, or a date-backed calendar. Compile the
    // exact preview before accepting it from the native agent.
    const compiled = compileItemTypeBlueprint(blueprint, { id: "preview.item-type" });
    if (current && preserveFields) assertCompatibleItemTypeFields(compileItemTypeBlueprint(current, { id: "preview.item-type" }).fields, compiled.fields);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid item type.";
    throw new Error(
      `Improve the item type and return a corrected blueprint: ${reason}`,
    );
  }
  return blueprint;
}

export function parseNativeItemTypePreviewArguments(
  value: unknown,
  request = "",
  current?: ItemTypeBlueprint,
  preserveFields = true,
): ItemTypeBlueprint {
  const input =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!input || typeof input !== "object" || !("blueprint" in input)) {
    if (
      input &&
      typeof input === "object" &&
      "blueprint_json" in input &&
      typeof (input as { blueprint_json?: unknown }).blueprint_json === "string"
    ) {
      return validateNativeBlueprint(
        JSON.parse((input as { blueprint_json: string }).blueprint_json),
        request,
        current,
        preserveFields,
      );
    }
    throw new Error("The connected agent did not return an item-type blueprint.");
  }
  return validateNativeBlueprint(
    (input as { blueprint: unknown }).blueprint,
    request,
    current,
    preserveFields,
  );
}

export function nativeItemTypeDesignPrompt({
  current,
  folderName,
  request,
}: {
  current?: ItemTypeBlueprint;
  folderName?: string;
  request: string;
}): string {
  const context = [
    folderName ? `Target folder: ${folderName}` : null,
    current
      ? `Current blueprint to revise:\n${JSON.stringify(current)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    "Design a reusable TextText item type for the writer's request below.",
    "Return only a JSON object with a blueprint_json string containing the complete blueprint. TextText will validate it and show the preview.",
    "Do not call tools. Do not save or change workspace content.",
    folderName
      ? "Start from the folder's existing items. Add properties only when the writer asks to record new information. Existing images and captions live in content.assets: use collection.assetPreview to show them, never create empty image or caption properties for that purpose. Design both the item page and folder listing."
      : "Infer sensible fields and example content. Design both the individual item page and the folder listing. Honor named visual references through safe theme tokens, without copying a brand.",
    "When useful, include relations, people records, recurrence, a closed status workflow, read-only computed rollups, conditional details, validation constraints, and named folder views. Keep the result focused rather than adding every capability.",
    `${ITEM_TYPE_BLUEPRINT_FORMAT}\nEncode the finished object as the blueprint_json string argument.`,
    context || null,
    `Writer request:\n${request.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
