import {
  itemTypeBlueprintSchema,
  type ItemTypeBlueprint,
} from "@/lib/presentation/item-type-blueprint";
import {
  ITEM_TYPE_BLUEPRINT_FORMAT,
  honorNamedStyleReference,
} from "@/lib/ai/item-type-generation";

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
      return honorNamedStyleReference(
        itemTypeBlueprintSchema.parse(
          JSON.parse((input as { blueprint_json: string }).blueprint_json),
        ),
        request,
      );
    }
    throw new Error("The connected agent did not return an item-type blueprint.");
  }
  return honorNamedStyleReference(
    itemTypeBlueprintSchema.parse(
      (input as { blueprint: unknown }).blueprint,
    ),
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
    `Call ${NATIVE_ITEM_TYPE_PREVIEW_TOOL_NAME} exactly once with a complete blueprint.`,
    "Do not call any other tool. Do not save or change workspace content.",
    "Infer sensible fields and example content. Design both the individual item page and the folder listing. Honor named visual references through safe theme tokens, without copying a brand.",
    `${ITEM_TYPE_BLUEPRINT_FORMAT}\nEncode the finished object as the blueprint_json string argument.`,
    context || null,
    `Writer request:\n${request.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
