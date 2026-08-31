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
  workspaceToolModelSchema,
  workspaceToolModelDescription,
} from "@/lib/ai/tools";
import { isProposableWorkspaceWrite } from "@/lib/ai/write-proposal-policy";
import {
  createWorkspaceWriteProposal,
  type WorkspaceWriteProposalPreview,
} from "@/lib/ai/write-proposals.server";
import type { OutboundMcpProposalPreview } from "@/lib/ai/outbound-proposals.server";
import { runWorkspaceToolForSession } from "@/lib/mcp/tools";

type CloudAssistantActor = {
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
  /**
   * Whether the command itself succeeded.
   *
   * A failed command used to be thrown and forgotten: the model was told, and
   * narrated the failure in its own words, but nothing reached the client. The
   * turn was then labelled Done over a change that never happened, and the only
   * failure text on screen was model prose. Recording the failure keeps both
   * honest, and the throw below still lets the model recover.
   */
  status: "ok" | "failed";
  /** The command's own message, never the model's retelling of it. */
  error?: string;
};

export type CloudAssistantToolMode = "full" | "read_only";

export type CloudAssistantWriteProposal =
  WorkspaceWriteProposalPreview | OutboundMcpProposalPreview;

export function cloudAssistantToolNames(
  mode: CloudAssistantToolMode = "full",
): WorkspaceToolName[] {
  return WORKSPACE_TOOL_NAMES.filter((name) => {
    const definition = WORKSPACE_TOOL_DEFINITIONS[name];
    if (mode === "read_only" && definition.mutability !== "read") return false;
    // Confirmation-gated tools are offered only when a proposal can genuinely
    // stand in for the confirmation: the owner shown what will happen in words
    // they recognise, and approval failing closed if the world has moved. That
    // is a per-command judgement and isProposableWorkspaceWrite holds it.
    // Anything else confirmation-gated stays out, as it always was.
    if (
      definition.confirmation !== "none" &&
      !isProposableWorkspaceWrite(name)
    ) {
      return false;
    }
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
    tools[name] = tool({
      description: workspaceToolModelDescription(name),
      // The canonical JSON schema (uniform type) rather than the per-tool Zod
      // union, so the dynamic tool map typechecks; the executor re-validates.
      inputSchema: jsonSchema(workspaceToolModelSchema(name)),
      execute: async (args: unknown) => {
        const commandArgs = (args ?? {}) as Record<string, unknown>;
        const result = await runWorkspaceToolForSession(
          name,
          commandArgs,
          actor,
        );
        const text = resultText(result);
        if (result.isError) {
          const message = text || `${name} failed`;
          onWorkspaceCall?.({
            tool: name,
            args: commandArgs,
            output: {},
            status: "failed",
            error: message,
          });
          throw new Error(message);
        }
        onWorkspaceCall?.({
          tool: name,
          args: commandArgs,
          output: result.structuredContent ?? {},
          status: "ok",
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
      description: workspaceToolModelDescription(name),
      inputSchema: jsonSchema(workspaceToolModelSchema(name)),
      execute: async (args: unknown) => {
        const commandArgs = (args ?? {}) as Record<string, unknown>;
        if (definition.mutability === "write") {
          // A write that cannot even be STAGED has to say so. Without this the
          // failure was invisible from both ends: nothing was proposed, so no
          // card appeared, and the only account on screen was the model's
          // prose about a change it never got to offer.
          let proposal: WorkspaceWriteProposalPreview;
          try {
            proposal = await createWorkspaceWriteProposal({
              actor,
              tool: name,
              arguments: commandArgs,
            });
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : `${name} could not be prepared for review.`;
            onWorkspaceCall?.({
              tool: name,
              args: commandArgs,
              output: {},
              status: "failed",
              error: message,
            });
            throw new Error(message);
          }
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
        if (result.isError) {
          const message = text || `${name} failed`;
          onWorkspaceCall?.({
            tool: name,
            args: commandArgs,
            output: {},
            status: "failed",
            error: message,
          });
          throw new Error(message);
        }
        onWorkspaceCall?.({
          tool: name,
          args: commandArgs,
          output: result.structuredContent ?? {},
          status: "ok",
        });
        return text || "Done.";
      },
    });
  }
  return tools;
}
