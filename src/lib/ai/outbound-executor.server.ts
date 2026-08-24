import { recordAction, recordActionStrict } from "@/lib/audit";
import {
  callRemoteTool,
  type OutboundConnection,
  type RemoteCallResult,
  type RemoteTool,
} from "@/lib/mcp/outbound-client";

export type OutboundToolActor = {
  userId: string | null;
  handle: string;
};

export type OutboundCallRecord = {
  connection: string;
  tool: string;
  status: "ok" | "input_required" | "failed" | "ambiguous";
};

export class OutboundExecutionAmbiguousError extends Error {
  constructor(readonly result: RemoteCallResult) {
    super(
      "The external tool returned a result, but TextText could not save its audit record. It may have completed. Verify the external system before retrying.",
    );
    this.name = "OutboundExecutionAmbiguousError";
  }
}

/** One audited path for owner-approved remote calls. */
export async function executeOutboundAssistantTool(
  actor: OutboundToolActor,
  connection: OutboundConnection,
  remote: Pick<RemoteTool, "name">,
  input: Record<string, unknown>,
  options: {
    onCall?: (record: OutboundCallRecord) => void;
    approvedProposalId: string;
  },
): Promise<RemoteCallResult> {
  if (!options.approvedProposalId?.trim()) {
    throw new Error(
      "An external tool call requires a claimed approval proposal.",
    );
  }
  let result: RemoteCallResult;
  try {
    result = await callRemoteTool(connection, remote.name, input);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "That call failed.";
    await recordAction({
      actorUserId: actor.userId,
      actorType: "human",
      actionName: "mcp.outbound_approved_call_failed",
      targetType: "workspace",
      targetId: connection.id,
      inputSummary: [
        `${connection.name}: ${remote.name}`,
        `Proposal: ${options.approvedProposalId}`,
      ].join("; "),
      outputSummary: message.slice(0, 300),
    });
    options.onCall?.({
      connection: connection.name,
      tool: remote.name,
      status: "failed",
    });
    throw error instanceof Error ? error : new Error(message);
  }

  try {
    await recordActionStrict({
      actorUserId: actor.userId,
      actorType: "human",
      actionName: result.status === "input_required"
        ? "mcp.outbound_approved_input_required"
        : "mcp.outbound_approved_call",
      targetType: "workspace",
      targetId: connection.id,
      inputSummary: [
        `${connection.name}: ${remote.name}`,
        `Proposal: ${options.approvedProposalId}`,
      ].join("; "),
      outputSummary:
        result.status === "input_required"
          ? "server asked for input"
          : `${result.text.length} chars`,
    });
  } catch {
    options.onCall?.({
      connection: connection.name,
      tool: remote.name,
      status: "ambiguous",
    });
    throw new OutboundExecutionAmbiguousError(result);
  }
  options.onCall?.({
    connection: connection.name,
    tool: remote.name,
    status: result.status,
  });
  return result;
}

export function remoteInputRequiredText(
  connectionName: string,
  result: Extract<RemoteCallResult, { status: "input_required" }>,
): string {
  const asked = result.asked.length
    ? ` It asked: ${result.asked.join("; ")}`
    : "";
  return `NOT DONE. ${connectionName} needs more information before it can run this, and TextText cannot answer that mid-call yet.${asked} Tell the person what was asked for; do not claim the action happened.`;
}
