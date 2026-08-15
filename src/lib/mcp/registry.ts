// The server's capability registry, independent of any transport.
//
// MCP 2026-07-28 is stateless, so there is no long-lived `Server` object to
// register things onto: a request arrives, we look the capability up here, and
// we answer. This module owns that lookup.
//
// `registerAgentSurface` still calls `registerResource`/`registerPrompt` with
// the shapes the SDK used, so agent-surface.ts did not need rewriting when the
// transport was replaced. Tools come straight from the shared workspace
// registry, which was always the source of truth.

import { ResourceTemplate } from "./types";
import type { CallToolResult } from "./types";
import {
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
  type WorkspaceToolName,
} from "@/lib/ai/tools";
import { registerAgentSurface } from "./agent-surface";
import { executeMcpTool, type ToolContext } from "./tools";
import { invalidParams, methodNotFound } from "./protocol";

export type ResourceHandler = (
  uri: URL,
  variablesOrExtra: unknown,
  maybeExtra?: unknown,
) => Promise<{ contents: unknown[] }>;

export type ResourceEntry = {
  name: string;
  uri: string | null;
  uriTemplate: string | null;
  title?: string;
  description?: string;
  mimeType?: string;
  handler: ResourceHandler;
  template: ResourceTemplate | null;
};

export type PromptEntry = {
  name: string;
  title?: string;
  description?: string;
  argsSchema: Record<string, { describe?: unknown; isOptional?: () => boolean }>;
  handler: (args: Record<string, string>) => Promise<{ messages: unknown[] }>;
};

const resources: ResourceEntry[] = [];
const prompts: PromptEntry[] = [];

/** Mirrors the SDK surface `agent-surface.ts` was written against, so the
 * declarations there are transport-agnostic data rather than SDK calls. */
const collector = {
  registerResource(
    name: string,
    uriOrTemplate: string | ResourceTemplate,
    config: { title?: string; description?: string; mimeType?: string },
    handler: ResourceHandler,
  ) {
    const isTemplate = typeof uriOrTemplate !== "string";
    resources.push({
      name,
      uri: isTemplate ? null : uriOrTemplate,
      uriTemplate: isTemplate
        ? uriOrTemplate.uriTemplate.toString()
        : null,
      template: isTemplate ? uriOrTemplate : null,
      title: config.title,
      description: config.description,
      mimeType: config.mimeType,
      handler,
    });
  },
  registerPrompt(
    name: string,
    config: {
      title?: string;
      description?: string;
      argsSchema?: PromptEntry["argsSchema"];
    },
    handler: PromptEntry["handler"],
  ) {
    prompts.push({
      name,
      title: config.title,
      description: config.description,
      argsSchema: config.argsSchema ?? {},
      handler,
    });
  },
};

registerAgentSurface(collector as never);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * `tools/list` in a deterministic order. The revision asks for this so clients
 * can cache the catalog and so a stable ordering keeps LLM prompt-cache hits
 * high. `WORKSPACE_TOOL_NAMES` is already a fixed array, so the order is the
 * declaration order and does not vary per call or per token.
 */
export function listTools() {
  return WORKSPACE_TOOL_NAMES.map((name) => {
    const definition = WORKSPACE_TOOL_DEFINITIONS[name];
    return {
      name,
      title: definition.title,
      description: definition.description,
      inputSchema: definition.jsonSchema,
      annotations: definition.annotations,
    };
  });
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<CallToolResult> {
  if (!(name in WORKSPACE_TOOL_DEFINITIONS)) {
    // An unknown TOOL is a bad argument to a known method, not an unknown
    // method, so this is Invalid Params rather than Method Not Found.
    throw invalidParams(`Unknown tool: ${name}`);
  }
  return executeMcpTool(name as WorkspaceToolName, args, context);
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export function listResources() {
  return resources
    .filter((entry) => entry.uri)
    .map((entry) => ({
      uri: entry.uri as string,
      name: entry.name,
      title: entry.title,
      description: entry.description,
      mimeType: entry.mimeType,
    }));
}

export function listResourceTemplates() {
  return resources
    .filter((entry) => entry.uriTemplate)
    .map((entry) => ({
      uriTemplate: entry.uriTemplate as string,
      name: entry.name,
      title: entry.title,
      description: entry.description,
      mimeType: entry.mimeType,
    }));
}

/** Match a concrete URI against a `texttext://items/{id}` style template and
 * pull the variables out. Kept deliberately small: the only templates this
 * server exposes are single-segment substitutions. */
function matchTemplate(
  template: string,
  uri: string,
): Record<string, string> | null {
  const names: string[] = [];
  const pattern = template.replace(/\{([^}]+)\}/g, (_all, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  const match = new RegExp(`^${pattern}$`).exec(uri);
  if (!match) return null;
  return Object.fromEntries(
    names.map((name, index) => [name, decodeURIComponent(match[index + 1])]),
  );
}

export async function readResource(uri: string, context: ToolContext) {
  const exact = resources.find((entry) => entry.uri === uri);
  if (exact) return exact.handler(new URL(uri), context);

  for (const entry of resources) {
    if (!entry.uriTemplate) continue;
    const variables = matchTemplate(entry.uriTemplate, uri);
    if (variables) return entry.handler(new URL(uri), variables, context);
  }
  // Resource-not-found is -32602 in this revision; -32002 is reserved and
  // MUST NOT be emitted.
  throw invalidParams(`Unknown resource: ${uri}`);
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export function listPrompts() {
  return prompts.map((entry) => ({
    name: entry.name,
    title: entry.title,
    description: entry.description,
    arguments: Object.entries(entry.argsSchema).map(([name, schema]) => ({
      name,
      description:
        typeof (schema as { description?: string }).description === "string"
          ? (schema as { description?: string }).description
          : undefined,
      required:
        typeof schema.isOptional === "function" ? !schema.isOptional() : true,
    })),
  }));
}

export async function getPrompt(
  name: string,
  args: Record<string, string>,
) {
  const entry = prompts.find((prompt) => prompt.name === name);
  if (!entry) throw invalidParams(`Unknown prompt: ${name}`);
  return entry.handler(args);
}

export { methodNotFound };
