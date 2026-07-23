import {
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
} from "./tools";

const NATIVE_TEMPLATE_OPERATIONS = new Set([
  "set-name",
  "set-description",
  "set-capabilities",
  "set-theme",
  "set-collection-layout",
]);

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function requiredObject(value: unknown, path: string): JsonObject {
  const result = object(value);
  if (!result) {
    throw new Error(`Invalid canonical tool schema at ${path}`);
  }
  return result;
}

/**
 * Foundation Models crashes while compiling the complete recursive render-node
 * union. The local model gets a canonical subset of the same operation grammar;
 * cloud providers and MCP retain the complete primitive-composition surface.
 * Calls from this projection still pass through the full TypeScript parser.
 */
function nativeInputSchema(
  name: (typeof WORKSPACE_TOOL_NAMES)[number],
): JsonObject {
  const schema = structuredClone(
    WORKSPACE_TOOL_DEFINITIONS[name].jsonSchema,
  ) as JsonObject;
  delete schema.$schema;
  if (name !== "customize_document_template") return schema;

  const properties = requiredObject(schema.properties, "properties");
  const operations = requiredObject(
    properties.operations,
    "properties.operations",
  );
  const items = requiredObject(
    operations.items,
    "properties.operations.items",
  );
  const alternatives = Array.isArray(items?.oneOf) ? items.oneOf : [];
  items.oneOf = alternatives.filter((alternative) => {
    const alternativeProperties = object(object(alternative)?.properties);
    const operation = object(alternativeProperties?.op);
    return (
      typeof operation?.const === "string" &&
      NATIVE_TEMPLATE_OPERATIONS.has(operation.const)
    );
  });
  delete schema.definitions;
  return schema;
}

export const NATIVE_WORKSPACE_TOOL_CONTRACT = WORKSPACE_TOOL_NAMES.map((name) => {
  const definition = WORKSPACE_TOOL_DEFINITIONS[name];
  return {
    name,
    description: definition.description,
    inputSchema: nativeInputSchema(name),
  };
});
