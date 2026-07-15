import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
} from "@/lib/ai/tools";

type NativeToolContract = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

function nativeToolContract(): NativeToolContract[] {
  const source = readFileSync(
    resolve(process.cwd(), "mac/Sources/Write/NativeAI.swift"),
    "utf8",
  );
  const match = source.match(
    /private static let agentToolContractJSON = #"""\n([\s\S]*?)\n\s*"""#/,
  );
  if (!match) throw new Error("Native AI tool contract manifest is missing");
  return JSON.parse(match[1]) as NativeToolContract[];
}

describe("native workspace tool parity", () => {
  it("matches every canonical tool name, description, and input schema", () => {
    const canonical = WORKSPACE_TOOL_NAMES.map((name) => {
      const definition = WORKSPACE_TOOL_DEFINITIONS[name];
      const inputSchema = { ...definition.jsonSchema };
      delete inputSchema.$schema;
      return {
        name,
        description: definition.description,
        inputSchema,
      };
    });

    expect(nativeToolContract()).toEqual(canonical);
  });

  it("keeps legacy aliases and permanent deletion out of the native surface", () => {
    const contract = nativeToolContract();
    const schemas = Object.fromEntries(
      contract.map((tool) => [tool.name, tool.inputSchema]),
    ) as Record<string, { properties?: Record<string, unknown> }>;

    expect(contract).toHaveLength(17);
    expect(contract.some((tool) => tool.name.includes("permanent"))).toBe(false);
    expect(schemas.list_items.properties).not.toHaveProperty("folder");
    expect(schemas.create_item.properties).not.toHaveProperty("folder");
    expect(schemas.append_to_item.properties).not.toHaveProperty("markdown");
    expect(schemas.set_item_pinned.properties?.pinned).toEqual({
      type: "boolean",
    });
  });
});
