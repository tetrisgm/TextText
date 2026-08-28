import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { recordAction } from "@/lib/audit";
import {
  WRITE_PROPOSAL_TTL_MS,
  MAX_WRITE_PROPOSAL_TTL_MS,
} from "@/lib/ai/write-proposal-policy";
import {
  databaseWorkspaceWriteProposalRepository,
  type AssistantProposalReceipt,
  type WorkspaceWriteProposalActor,
  type WorkspaceWriteProposalBinding,
  type WorkspaceWriteProposalRepository,
} from "@/lib/ai/write-proposals.server";
import {
  executeOutboundAssistantTool,
  OutboundExecutionAmbiguousError,
  remoteInputRequiredText,
} from "@/lib/ai/outbound-executor.server";
import {
  listRemoteTools,
  type OutboundConnection,
  type RemoteCallResult,
  type RemoteTool,
} from "@/lib/mcp/outbound-client";
import { enabledMcpConnection } from "@/lib/mcp/outbound.server";
import { fingerprintProtectedValue } from "@/lib/secret-box";
import { getBlogEditRecord } from "@/lib/store";

const MAX_OUTBOUND_ARGUMENT_BYTES = 64_000;
const MAX_OUTBOUND_DEFINITION_BYTES = 256_000;

export type OutboundMcpProposalPreview = {
  id: string;
  kind: "outbound_mcp";
  status: "pending";
  tool: string;
  title: string;
  summary: string;
  arguments: Record<string, unknown>;
  connection: { id: string; name: string };
  remoteTool: {
    name: string;
    description: string;
    annotations: NonNullable<RemoteTool["annotations"]>;
  };
  createdAt: string;
  expiresAt: string;
};

type OutboundMcpProposalDecision =
  | { status: "completed"; receipt: AssistantProposalReceipt }
  | { status: "denied"; proposalId: string }
  | { status: "ambiguous"; proposalId: string; message: string }
  | { status: "expired" | "already_used" | "not_found"; proposalId: string }
  | { status: "failed"; proposalId: string; message: string };

type WorkspaceRecord = { id: string; handle: string; ownerId: string | null };

type FrozenRemoteDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: NonNullable<RemoteTool["annotations"]>;
};

export type OutboundMcpProposalDependencies = {
  repository: WorkspaceWriteProposalRepository;
  resolveWorkspace(handle: string): Promise<WorkspaceRecord | null>;
  resolveConnection(
    blogId: string,
    connectionId: string,
  ): Promise<OutboundConnection | null>;
  discover(connection: OutboundConnection): Promise<{ tools: RemoteTool[] }>;
  execute(
    actor: WorkspaceWriteProposalActor,
    connection: OutboundConnection,
    remote: RemoteTool,
    args: Record<string, unknown>,
    proposalId: string,
  ): Promise<RemoteCallResult>;
  fingerprintConnection(connection: OutboundConnection): string;
  auditRejected(
    actor: WorkspaceWriteProposalActor,
    workspace: WorkspaceRecord,
    proposalId: string,
    reason: "expired" | "already_used" | "not_found",
  ): Promise<void>;
  now(): Date;
  randomId(): string;
};

const defaultDependencies: OutboundMcpProposalDependencies = {
  repository: databaseWorkspaceWriteProposalRepository,
  resolveWorkspace: getBlogEditRecord,
  resolveConnection: enabledMcpConnection,
  discover: listRemoteTools,
  execute: (actor, connection, remote, args, proposalId) =>
    executeOutboundAssistantTool(actor, connection, remote, args, {
      approvedProposalId: proposalId,
    }),
  fingerprintConnection: (connection) =>
    fingerprintProtectedValue(
      "outbound-mcp-connection-v1",
      stableJson({
        id: connection.id,
        name: connection.name,
        url: connection.url,
        token: connection.token,
      }),
    ),
  auditRejected: (actor, workspace, proposalId, reason) =>
    recordAction({
      actorUserId: actor.userId,
      actorType: "human",
      actionName: "ai.proposal_rejected",
      targetType: "workspace",
      targetId: workspace.id,
      inputSummary: `${reason}; Proposal: ${proposalId}`,
    }),
  now: () => new Date(),
  randomId: randomUUID,
};

function serializedByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

class OutboundProposalValidationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "OutboundProposalValidationError";
  }
}

function validateOutboundMcpArguments(
  remote: RemoteTool,
  input: unknown,
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OutboundProposalValidationError(
      "Remote tool arguments must be an object.",
      "arguments_invalid",
    );
  }
  if (serializedByteLength(input) > MAX_OUTBOUND_ARGUMENT_BYTES) {
    throw new OutboundProposalValidationError(
      "That remote tool request is too large.",
      "arguments_too_large",
    );
  }
  try {
    const schema = z.fromJSONSchema(remote.inputSchema as never);
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw new OutboundProposalValidationError(
        parsed.error.issues[0]?.message || "Remote tool arguments are invalid.",
        "arguments_invalid",
      );
    }
    if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
      throw new OutboundProposalValidationError(
        "Remote tool arguments must be an object.",
        "arguments_invalid",
      );
    }
    return parsed.data as Record<string, unknown>;
  } catch (error) {
    if (error instanceof OutboundProposalValidationError) throw error;
    throw new OutboundProposalValidationError(
      "That remote tool published an input schema TextText cannot validate.",
      "schema_invalid",
    );
  }
}

async function ownerBinding(
  actor: WorkspaceWriteProposalActor,
  dependencies: OutboundMcpProposalDependencies,
): Promise<{ binding: WorkspaceWriteProposalBinding; workspace: WorkspaceRecord } | null> {
  if (!actor.userId) return null;
  const workspace = await dependencies.resolveWorkspace(actor.handle);
  if (!workspace || workspace.ownerId !== actor.userId) return null;
  return {
    binding: { blogId: workspace.id, actorUserId: actor.userId },
    workspace,
  };
}

function cleanRemoteAnnotations(remote: RemoteTool) {
  const raw = remote.annotations ?? {};
  const annotations: NonNullable<RemoteTool["annotations"]> = {};
  if (typeof raw.title === "string") annotations.title = raw.title.slice(0, 200);
  for (const key of [
    "readOnlyHint",
    "destructiveHint",
    "idempotentHint",
    "openWorldHint",
  ] as const) {
    if (typeof raw[key] === "boolean") annotations[key] = raw[key];
  }
  return annotations;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function frozenRemoteDefinition(remote: RemoteTool): FrozenRemoteDefinition {
  const definition = {
    name: remote.name,
    description: remote.description.slice(0, 600),
    inputSchema: remote.inputSchema,
    annotations: cleanRemoteAnnotations(remote),
  };
  if (serializedByteLength(definition) > MAX_OUTBOUND_DEFINITION_BYTES) {
    throw new OutboundProposalValidationError(
      "That remote tool definition is too large to review safely.",
      "definition_too_large",
    );
  }
  return definition;
}

function definitionFingerprint(definition: FrozenRemoteDefinition): string {
  return createHash("sha256").update(stableJson(definition)).digest("hex");
}

function cleanRemoteMetadata(
  remote: RemoteTool,
  connection: OutboundConnection,
  connectionFingerprint: string,
) {
  const definition = frozenRemoteDefinition(remote);
  return {
    connectionName: connection.name.slice(0, 120),
    connectionFingerprint,
    remoteDefinition: definition,
    definitionFingerprint: definitionFingerprint(definition),
  };
}

function reviewedDefinitionMatches(
  metadata: Record<string, unknown> | null,
  current: RemoteTool,
): boolean {
  const frozen = metadata?.remoteDefinition;
  const expected = metadata?.definitionFingerprint;
  if (
    !frozen ||
    typeof frozen !== "object" ||
    Array.isArray(frozen) ||
    typeof expected !== "string"
  ) {
    return false;
  }
  const stored = frozen as FrozenRemoteDefinition;
  if (definitionFingerprint(stored) !== expected) return false;
  return definitionFingerprint(frozenRemoteDefinition(current)) === expected;
}

export async function createOutboundMcpProposal(
  input: {
    actor: WorkspaceWriteProposalActor;
    connection: OutboundConnection;
    remote: RemoteTool;
    arguments: unknown;
    ttlMs?: number;
  },
  dependencies: OutboundMcpProposalDependencies = defaultDependencies,
): Promise<OutboundMcpProposalPreview> {
  const owner = await ownerBinding(input.actor, dependencies);
  if (!owner) throw new Error("Only the workspace owner can stage a remote call.");
  const connected = await dependencies.resolveConnection(
    owner.workspace.id,
    input.connection.id,
  );
  if (
    !connected ||
    connected.name !== input.connection.name ||
    connected.url !== input.connection.url ||
    connected.token !== input.connection.token
  ) {
    throw new Error("That MCP connection is no longer enabled.");
  }
  const args = validateOutboundMcpArguments(input.remote, input.arguments);
  const now = dependencies.now();
  const ttl = Math.min(
    Math.max(1_000, input.ttlMs ?? WRITE_PROPOSAL_TTL_MS),
    MAX_WRITE_PROPOSAL_TTL_MS,
  );
  const expiresAt = new Date(now.getTime() + ttl);
  const id = dependencies.randomId();
  const metadata = cleanRemoteMetadata(
    input.remote,
    connected,
    dependencies.fingerprintConnection(connected),
  );
  const reviewedDefinition = metadata.remoteDefinition;
  await dependencies.repository.create({
    id,
    ...owner.binding,
    proposalKind: "outbound_mcp",
    connectionId: connected.id,
    toolName: input.remote.name,
    arguments: args,
    metadata,
    status: "pending",
    createdAt: now,
    expiresAt,
  });
  return {
    id,
    kind: "outbound_mcp",
    status: "pending",
    tool: input.remote.name,
    title: `Review external tool call`,
    summary: `${connected.name} · ${input.remote.name}`,
    arguments: args,
    connection: { id: connected.id, name: connected.name },
    remoteTool: {
      name: input.remote.name,
      description: reviewedDefinition.description,
      annotations: reviewedDefinition.annotations,
    },
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

async function unavailableDecision(
  id: string,
  binding: WorkspaceWriteProposalBinding,
  now: Date,
  repository: WorkspaceWriteProposalRepository,
): Promise<OutboundMcpProposalDecision> {
  const state = await repository.state(id, binding);
  if (!state) return { status: "not_found", proposalId: id };
  if (state.status === "pending" && state.expiresAt.getTime() <= now.getTime()) {
    return { status: "expired", proposalId: id };
  }
  if (state.status === "completed" && state.receipt?.kind === "outbound_mcp") {
    return { status: "completed", receipt: state.receipt };
  }
  if (state.status === "denied") {
    return { status: "denied", proposalId: id };
  }
  if (
    state.status === "completed" ||
    state.failureCode === "receipt_recording_failed_after_success" ||
    state.failureCode === "audit_recording_failed_after_remote_result"
  ) {
    return {
      status: "ambiguous",
      proposalId: id,
      message:
        "The external tool may have completed, but TextText could not recover its receipt. Verify the external system before retrying.",
    };
  }
  return { status: "already_used", proposalId: id };
}

export async function decideOutboundMcpProposal(
  input: {
    actor: WorkspaceWriteProposalActor;
    proposalId: string;
    decision: "approve" | "deny";
  },
  dependencies: OutboundMcpProposalDependencies = defaultDependencies,
): Promise<OutboundMcpProposalDecision> {
  const owner = await ownerBinding(input.actor, dependencies);
  if (!owner) return { status: "not_found", proposalId: input.proposalId };
  const known = await dependencies.repository.get(
    input.proposalId,
    owner.binding,
  );
  if (!known || known.proposalKind !== "outbound_mcp") {
    await dependencies.auditRejected(
      input.actor,
      owner.workspace,
      input.proposalId,
      "not_found",
    );
    return { status: "not_found", proposalId: input.proposalId };
  }
  const now = dependencies.now();
  if (input.decision === "deny") {
    const denied = await dependencies.repository.deny(
      input.proposalId,
      owner.binding,
      now,
    );
    if (denied) return { status: "denied", proposalId: input.proposalId };
    const unavailable = await unavailableDecision(
      input.proposalId,
      owner.binding,
      now,
      dependencies.repository,
    );
    if (
      unavailable.status === "expired" ||
      unavailable.status === "already_used" ||
      unavailable.status === "not_found"
    ) {
      await dependencies.auditRejected(
        input.actor,
        owner.workspace,
        input.proposalId,
        unavailable.status,
      );
    }
    return unavailable;
  }
  const claimed = await dependencies.repository.claim(
    input.proposalId,
    owner.binding,
    now,
  );
  if (!claimed) {
    const unavailable = await unavailableDecision(
      input.proposalId,
      owner.binding,
      now,
      dependencies.repository,
    );
    if (
      unavailable.status === "expired" ||
      unavailable.status === "already_used" ||
      unavailable.status === "not_found"
    ) {
      await dependencies.auditRejected(
        input.actor,
        owner.workspace,
        input.proposalId,
        unavailable.status,
      );
    }
    return unavailable;
  }

  try {
    if (!claimed.connectionId) throw new Error("The MCP connection was removed.");
    const connection = await dependencies.resolveConnection(
      owner.workspace.id,
      claimed.connectionId,
    );
    if (!connection) throw new Error("That MCP connection is no longer enabled.");
    if (
      claimed.metadata?.connectionFingerprint !==
      dependencies.fingerprintConnection(connection)
    ) {
      throw new Error(
        "That MCP destination changed after review. Ask the assistant to prepare a new proposal.",
      );
    }
    const discovered = await dependencies.discover(connection);
    const remote = discovered.tools.find((tool) => tool.name === claimed.toolName);
    if (!remote) throw new Error("That remote tool is no longer available.");
    if (!reviewedDefinitionMatches(claimed.metadata, remote)) {
      throw new Error(
        "That remote tool changed after review. Ask the assistant to prepare a new proposal.",
      );
    }
    const args = validateOutboundMcpArguments(remote, claimed.arguments);
    const result = await dependencies.execute(
      input.actor,
      connection,
      remote,
      args,
      input.proposalId,
    );
    if (result.status === "input_required") {
      await dependencies.repository.fail(
        input.proposalId,
        owner.binding,
        "input_required",
        dependencies.now(),
      );
      return {
        status: "failed",
        proposalId: input.proposalId,
        message: remoteInputRequiredText(connection.name, result),
      };
    }
    const completedAt = dependencies.now();
    const receipt: AssistantProposalReceipt = {
      proposalId: input.proposalId,
      kind: "outbound_mcp",
      tool: remote.name,
      status: "completed",
      text: result.text,
      output: { status: "ok" },
      connection: { id: connection.id, name: connection.name },
      completedAt: completedAt.toISOString(),
    };
    try {
      await dependencies.repository.complete(
        input.proposalId,
        owner.binding,
        receipt,
        completedAt,
      );
    } catch {
      // The remote side effect has already reported success. Preserve that
      // fact even when our durable receipt cannot be stored so the UI never
      // encourages an unsafe blind retry.
      try {
        await dependencies.repository.fail(
          input.proposalId,
          owner.binding,
          "receipt_recording_failed_after_success",
          dependencies.now(),
        );
      } catch {
        // The one-time claim still fences replay in this process.
      }
      return {
        status: "ambiguous",
        proposalId: input.proposalId,
        message:
          "The remote tool completed, but TextText could not save its receipt. Verify the result before retrying.",
      };
    }
    return { status: "completed", receipt };
  } catch (error) {
    if (error instanceof OutboundExecutionAmbiguousError) {
      try {
        await dependencies.repository.fail(
          input.proposalId,
          owner.binding,
          "audit_recording_failed_after_remote_result",
          dependencies.now(),
        );
      } catch {
        // The one-time claim still prevents replay. Preserve the truthful
        // ambiguous result even if the status write also fails.
      }
      return {
        status: "ambiguous",
        proposalId: input.proposalId,
        message: error.message,
      };
    }
    await dependencies.repository.fail(
      input.proposalId,
      owner.binding,
      "execution_error",
      dependencies.now(),
    );
    return {
      status: "failed",
      proposalId: input.proposalId,
      message: error instanceof Error
        ? error.message.slice(0, 500)
        : "The approved remote tool call failed.",
    };
  }
}
