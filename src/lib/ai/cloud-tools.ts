// AI SDK tool adapter for the cloud assistant rung. Each workspace command is
// exposed to the cloud model as a tool whose execute() delegates to
// runWorkspaceToolForSession, i.e. the exact same server executor the MCP server
// uses. The cloud loop is therefore the third consumer of the one command
// surface, inheriting every privacy, audit, and permission invariant.
//
// MVP safety boundary: the cloud loop runs tools SERVER-side, without the
// interactive confirmation the native (in-page) agent shows before a destructive
// action. So it is given only the tools the workspace already classifies as
// needing no confirmation. Trash, delete, empty-trash, restore, sharing, and
// publish (everything with a confirmation gate) are withheld until an
// interactive confirmation flow is wired for the web path. This only narrows
// what the model may call; the executor still enforces every invariant.

import { jsonSchema, tool, type Tool } from "ai";
import {
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
  type WorkspaceToolName,
} from "@/lib/ai/tools";
import { isProposableWorkspaceWrite } from "@/lib/ai/write-proposal-policy";
import {
  createWorkspaceWriteProposal,
  type WorkspaceWriteProposalPreview,
} from "@/lib/ai/write-proposals.server";
import type { OutboundMcpProposalPreview } from "@/lib/ai/outbound-proposals.server";
import { runWorkspaceToolForSession } from "@/lib/mcp/tools";

export type CloudAssistantActor = {
  sub: string;
  userId: string | null;
  handle: string;
};

/**
 * Exact workspace-command evidence from the cloud model loop.
 *
 * The route sends this only to the signed-in workspace owner. The client turns
 * it into a compact artifact receipt, so a successful create or edit cannot
 * end as an orphaned chat answer.
 */
export type CloudAssistantWorkspaceCall = {
  tool: WorkspaceToolName;
  args: Record<string, unknown>;
  output: unknown;
};

export type CloudAssistantToolMode = "full" | "read_only";

export type CloudAssistantWriteProposal =
  | WorkspaceWriteProposalPreview
  | OutboundMcpProposalPreview;

export function cloudAssistantToolNames(
  mode: CloudAssistantToolMode = "full",
): WorkspaceToolName[] {
  return WORKSPACE_TOOL_NAMES.filter((name) => {
    const definition = WORKSPACE_TOOL_DEFINITIONS[name];
    if (mode === "read_only" && definition.mutability !== "read") return false;
    // Exclude confirmation-gated tools (destructive / sharing / publish): the
    // web path has no interactive confirmation yet.
    if (definition.confirmation !== "none") return false;
    // Exclude open-world tools that fetch a model-chosen URL
    // (add_item_asset, recapture_bookmark). Running headless with no
    // confirmation, they are an outbound exfiltration channel a prompt injection
    // could steer (the fetched URL leaks item content in its query string). They
    // stay available on the confirmed native and MCP rungs.
    if (definition.annotations.openWorldHint) return false;
    return true;
  });
}

function resultText(
  result: Awaited<ReturnType<typeof runWorkspaceToolForSession>>,
): string {
  return (result.content ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function cloudAssistantTools(
  actor: CloudAssistantActor,
  onWorkspaceCall?: (call: CloudAssistantWorkspaceCall) => void,
  mode: CloudAssistantToolMode = "full",
): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const name of cloudAssistantToolNames(mode)) {
    const definition = WORKSPACE_TOOL_DEFINITIONS[name];
    tools[name] = tool({
      description: definition.description,
      // The canonical JSON schema (uniform type) rather than the per-tool Zod
      // union, so the dynamic tool map typechecks; the executor re-validates.
      inputSchema: jsonSchema(definition.jsonSchema),
      execute: async (args: unknown) => {
        const commandArgs = (args ?? {}) as Record<string, unknown>;
        const result = await runWorkspaceToolForSession(
          name,
          commandArgs,
          actor,
        );
        const text = resultText(result);
        if (result.isError) throw new Error(text || `${name} failed`);
        onWorkspaceCall?.({
          tool: name,
          args: commandArgs,
          output: result.structuredContent ?? {},
        });
        return text || "Done.";
      },
    });
  }
  return tools;
}

/**
 * Cloud tools for a turn with interactive approval wired on the client. Reads
 * still execute immediately. Safe writes only create a durable proposal and
 * return its opaque id; the canonical command executor is reached later by the
 * authenticated proposal decision route. Confirmation-gated and open-world
 * writes are absent from this map, not merely rejected after a call.
 */
export function guardedCloudAssistantTools(
  actor: CloudAssistantActor,
  onProposal: (proposal: CloudAssistantWriteProposal) => void,
  onWorkspaceCall?: (call: CloudAssistantWorkspaceCall) => void,
  mode: CloudAssistantToolMode = "full",
): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const name of cloudAssistantToolNames(mode)) {
    const definition = WORKSPACE_TOOL_DEFINITIONS[name];
    if (
      definition.mutability === "write" &&
      !isProposableWorkspaceWrite(name)
    ) {
      continue;
    }
    tools[name] = tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.jsonSchema),
      execute: async (args: unknown) => {
        const commandArgs = (args ?? {}) as Record<string, unknown>;
        if (definition.mutability === "write") {
          const proposal = await createWorkspaceWriteProposal({
            actor,
            tool: name,
            arguments: commandArgs,
          });
          onProposal(proposal);
          return JSON.stringify({
            approval_required: true,
            proposal_id: proposal.id,
            summary: proposal.summary,
            expires_at: proposal.expiresAt,
          });
        }
        const result = await runWorkspaceToolForSession(
          name,
          commandArgs,
          actor,
        );
        const text = resultText(result);
        if (result.isError) throw new Error(text || `${name} failed`);
        onWorkspaceCall?.({
          tool: name,
          args: commandArgs,
          output: result.structuredContent ?? {},
        });
        return text || "Done.";
      },
    });
  }
  return tools;
}
