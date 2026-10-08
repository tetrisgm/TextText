import { z } from "zod";
import {
  WORKSPACE_TOOL_DEFINITIONS,
  isWorkspaceToolName,
  parseWorkspaceToolInput,
  type WorkspaceToolName,
} from "@/lib/ai/tools";

import { VAULT_TOOL_NAMES, vaultToolDefinitions } from "@/lib/mcp/vault-contract";

const MAX_WRITE_PROPOSAL_ARGUMENT_BYTES = 1_050_000;
export const WRITE_PROPOSAL_TTL_MS = 15 * 60 * 1_000;
export const MAX_WRITE_PROPOSAL_TTL_MS = 30 * 60 * 1_000;

export class WriteProposalValidationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "tool_not_available"
      | "tool_not_safe"
      | "arguments_invalid"
      | "arguments_too_large",
  ) {
    super(message);
    this.name = "WriteProposalValidationError";
  }
}

/** Only canonical file commands may enter the durable approval queue. */
const PREVIEWABLE_DESTRUCTIVE: readonly WorkspaceToolName[] = ["delete_item", "restore_item"];

export function isProposableWorkspaceWrite(
  name: WorkspaceToolName,
): boolean {
  if (!(VAULT_TOOL_NAMES as readonly string[]).includes(name)) return false;
  const definition = WORKSPACE_TOOL_DEFINITIONS[name];
  if (definition.mutability !== "write") return false;
  if (definition.annotations.openWorldHint) return false;
  if (definition.confirmation === "none") return true;
  return PREVIEWABLE_DESTRUCTIVE.includes(name);
}

/** Whether staging this command must freeze a preview of what it will do. */
export function requiresFrozenPreview(name: WorkspaceToolName): boolean {
  return PREVIEWABLE_DESTRUCTIVE.includes(name);
}

function serializedByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function validateWorkspaceWriteProposal(
  name: string,
  input: unknown,
): { name: WorkspaceToolName; arguments: Record<string, unknown> } {
  if (!isWorkspaceToolName(name)) {
    throw new WriteProposalValidationError(
      "That workspace action is not available.",
      "tool_not_available",
    );
  }
  if (!isProposableWorkspaceWrite(name)) {
    throw new WriteProposalValidationError(
      "That workspace action cannot be staged by the cloud assistant.",
      "tool_not_safe",
    );
  }

  const schema = vaultToolDefinitions().find((tool) => tool.name === name)!.inputSchema;
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !Object.hasOwn(schema.properties ?? {}, key)) ||
      (schema.required ?? []).some((key) => !Object.hasOwn(input, key))) {
    throw new WriteProposalValidationError("Those file action arguments are invalid.", "arguments_invalid");
  }
  let parsed: unknown;
  try {
    parsed = parseWorkspaceToolInput(name, input);
  } catch (error) {
    const detail = error instanceof z.ZodError
      ? error.issues[0]?.message
      : null;
    throw new WriteProposalValidationError(
      detail || "Those workspace action arguments are invalid.",
      "arguments_invalid",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WriteProposalValidationError(
      "Workspace action arguments must be an object.",
      "arguments_invalid",
    );
  }
  if (serializedByteLength(parsed) > MAX_WRITE_PROPOSAL_ARGUMENT_BYTES) {
    throw new WriteProposalValidationError(
      "That proposed workspace change is too large.",
      "arguments_too_large",
    );
  }
  return { name, arguments: parsed as Record<string, unknown> };
}

function argumentTarget(args: Record<string, unknown>): string | null {
  for (const key of ["title", "name", "folder_path", "id", "folder_id"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().replace(/\s+/g, " ").slice(0, 120);
    }
  }
  return null;
}

export function workspaceWriteProposalSummary(
  name: WorkspaceToolName,
  args: Record<string, unknown>,
): string {
  const definition = WORKSPACE_TOOL_DEFINITIONS[name];
  const target = argumentTarget(args);
  const content = [args.body, args.markdown, args.markdown_fragment, args.capture]
    .find((value) => typeof value === "string") as string | undefined;
  const size = content ? `, ${content.length.toLocaleString("en-US")} characters` : "";
  return `${definition.title}${target ? `: ${target}` : ""}${size}`;
}
