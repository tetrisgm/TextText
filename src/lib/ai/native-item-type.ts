import {
  compileItemTypeBlueprint,
  itemTypeBlueprintSchema,
  type ItemTypeBlueprint,
} from "@/lib/presentation/item-type-blueprint";
import {
  ITEM_TYPE_BLUEPRINT_FORMAT,
  honorNamedStyleReference,
} from "@/lib/ai/item-type-generation";
import { assessItemTypeQuality } from "@/lib/presentation/item-type-quality";

export const NATIVE_ITEM_TYPE_PREVIEW_TOOL_NAME = "preview_item_type";

export const NATIVE_ITEM_TYPE_PREVIEW_TOOL = Object.freeze({
  name: NATIVE_ITEM_TYPE_PREVIEW_TOOL_NAME,
  description:
    "Return one complete reusable TextText item-type blueprint for preview. This does not save or apply anything. Call it exactly once after interpreting the writer's requested fields, item page, folder layout, and visual reference.",
  inputSchema: {
    type: "object",
    properties: {
      blueprint_json: {
        type: "string",
        description:
          "The complete item-type blueprint encoded as one JSON object string.",
      },
    },
    required: ["blueprint_json"],
    additionalProperties: false,
  },
});

function validateNativeBlueprint(
  value: unknown,
  request: string,
): ItemTypeBlueprint {
  const blueprint = honorNamedStyleReference(
    itemTypeBlueprintSchema.parse(value),
    request,
  );
  const review = assessItemTypeQuality(blueprint);
  if (!review.passes) {
    throw new Error(
      `Improve the item type and call ${NATIVE_ITEM_TYPE_PREVIEW_TOOL_NAME} again: ${review.findings
        .map((finding) => finding.message)
        .join(" ")}`,
    );
  }
  try {
    // Shape validation cannot prove cross-field relationships such as unique
    // ids, valid computed sources, or a date-backed calendar. Compile the
    // exact preview before accepting it from the native agent.
    compileItemTypeBlueprint(blueprint, { id: "preview.item-type" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid item type.";
    throw new Error(
      `Improve the item type and call ${NATIVE_ITEM_TYPE_PREVIEW_TOOL_NAME} again: ${reason}`,
    );
  }
  return blueprint;
}

export function parseNativeItemTypePreviewArguments(
  value: unknown,
  request = "",
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
      );
    }
    throw new Error("The connected agent did not return an item-type blueprint.");
  }
  return validateNativeBlueprint(
    (input as { blueprint: unknown }).blueprint,
    request,
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
    `Call ${NATIVE_ITEM_TYPE_PREVIEW_TOOL_NAME} with a complete blueprint. If its quality review rejects the design, fix every reported issue and call it again.`,
    "Do not call any other tool. Do not save or change workspace content.",
    "Infer sensible fields and example content. Design both the individual item page and the folder listing. Honor named visual references through safe theme tokens, without copying a brand.",
    "When useful, include relations, people records, recurrence, a closed status workflow, read-only computed rollups, conditional details, validation constraints, and named folder views. Keep the result focused rather than adding every capability.",
    `${ITEM_TYPE_BLUEPRINT_FORMAT}\nEncode the finished object as the blueprint_json string argument.`,
    context || null,
    `Writer request:\n${request.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
