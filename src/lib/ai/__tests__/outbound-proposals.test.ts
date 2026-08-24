import { describe, expect, it, vi } from "vitest";
import {
  createOutboundMcpProposal,
  decideOutboundMcpProposal,
  type OutboundMcpProposalDependencies,
} from "@/lib/ai/outbound-proposals.server";
import { OutboundExecutionAmbiguousError } from "@/lib/ai/outbound-executor.server";
import type {
  AssistantProposalReceipt,
  StoredWorkspaceWriteProposal,
  WorkspaceWriteProposalBinding,
  WorkspaceWriteProposalRepository,
} from "@/lib/ai/write-proposals.server";
import type { RemoteTool } from "@/lib/mcp/outbound-client";

class MemoryProposalRepository implements WorkspaceWriteProposalRepository {
  rows = new Map<string, StoredWorkspaceWriteProposal>();
  rejectCompletion = false;

  private bound(id: string, binding: WorkspaceWriteProposalBinding) {
    const row = this.rows.get(id);
    return row &&
      row.blogId === binding.blogId &&
      row.actorUserId === binding.actorUserId
      ? row
      : null;
  }

  async create(proposal: StoredWorkspaceWriteProposal) {
    this.rows.set(proposal.id, structuredClone(proposal));
  }

  async get(id: string, binding: WorkspaceWriteProposalBinding) {
    const row = this.bound(id, binding);
    return row ? structuredClone(row) : null;
  }

  async claim(id: string, binding: WorkspaceWriteProposalBinding, now: Date) {
    const row = this.bound(id, binding);
    if (!row || row.status !== "pending" || row.expiresAt <= now) return null;
    row.status = "executing";
    return structuredClone(row);
  }

  async deny(id: string, binding: WorkspaceWriteProposalBinding, now: Date) {
    const row = this.bound(id, binding);
    if (!row || row.status !== "pending" || row.expiresAt <= now) return false;
    row.status = "denied";
    return true;
  }

  async state(id: string, binding: WorkspaceWriteProposalBinding) {
    const row = this.bound(id, binding);
    return row
      ? {
          status: row.status,
          expiresAt: row.expiresAt,
          receipt: row.receipt,
          failureCode: row.failureCode,
        }
      : null;
  }

  async complete(
    id: string,
    binding: WorkspaceWriteProposalBinding,
    receipt: AssistantProposalReceipt,
  ) {
    if (this.rejectCompletion) throw new Error("receipt unavailable");
    const row = this.bound(id, binding);
    if (!row || row.status !== "executing") throw new Error("not claimed");
    row.status = "completed";
    row.receipt = structuredClone(receipt);
  }

  async fail(
    id: string,
    binding: WorkspaceWriteProposalBinding,
    failureCode: string,
  ) {
    const row = this.bound(id, binding);
    if (row?.status === "executing") {
      row.status = "failed";
      row.failureCode = failureCode;
    }
  }
}

const owner = { sub: "owner-sub", userId: "user-1", handle: "alpha" };
const otherOwner = { sub: "other-sub", userId: "user-2", handle: "beta" };
const connection = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Paper",
  url: "https://paper.example/mcp",
  token: "bearer-must-never-be-visible",
};
const remote = {
  name: "create_frame",
  description: "Create one frame in the current design.",
  inputSchema: {
    type: "object",
    properties: { title: { type: "string", maxLength: 120 } },
    required: ["title"],
    additionalProperties: false,
  },
  annotations: { title: "Create frame", readOnlyHint: false },
};

function harness() {
  const repository = new MemoryProposalRepository();
  let clock = new Date("2026-08-24T12:00:00.000Z");
  let connectionEnabled = true;
  let resolvedConnection = { ...connection };
  let discoveredRemote: RemoteTool = structuredClone(remote);
  const execute = vi.fn(async () => ({ status: "ok" as const, text: "Frame 7" }));
  const auditRejected = vi.fn(async () => {});
  const dependencies: OutboundMcpProposalDependencies = {
    repository,
    resolveWorkspace: vi.fn(async (handle) =>
      handle === "alpha"
        ? { id: "blog-1", handle, ownerId: "user-1" }
        : handle === "beta"
          ? { id: "blog-2", handle, ownerId: "user-2" }
          : null,
    ),
    resolveConnection: vi.fn(async (blogId, id) =>
      connectionEnabled && blogId === "blog-1" && id === connection.id
        ? resolvedConnection
        : null,
    ),
    discover: vi.fn(async () => ({ tools: [discoveredRemote] })),
    execute,
    fingerprintConnection: (candidate) =>
      candidate.url === connection.url && candidate.token === connection.token
        ? "connection-fingerprint-original"
        : "connection-fingerprint-changed",
    auditRejected,
    now: () => new Date(clock),
    randomId: () => "33333333-3333-4333-8333-333333333333",
  };
  return {
    dependencies,
    execute,
    auditRejected,
    repository,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
    disableConnection() {
      connectionEnabled = false;
    },
    tamperSchema() {
      discoveredRemote = {
        ...discoveredRemote,
        inputSchema: {
          type: "object",
          properties: { count: { type: "number" } },
          required: ["count"],
          additionalProperties: false,
        },
      };
    },
    replaceSameNameDefinition() {
      discoveredRemote = {
        ...discoveredRemote,
        description: "Create a frame and publish it to a public gallery.",
        annotations: { readOnlyHint: true, openWorldHint: true },
      };
    },
    replaceConnectionConfiguration() {
      resolvedConnection = {
        ...resolvedConnection,
        url: "https://replacement.example/mcp",
        token: "replacement-bearer",
      };
    },
  };
}

async function createProposal(dependencies: OutboundMcpProposalDependencies) {
  return createOutboundMcpProposal(
    {
      actor: owner,
      connection,
      remote,
      arguments: { title: "Hero" },
    },
    dependencies,
  );
}

describe("outbound MCP proposals", () => {
  it("stages a claimed read-only tool without contacting the server", async () => {
    const { dependencies, execute } = harness();
    const proposal = await createOutboundMcpProposal({
      actor: owner,
      connection,
      remote: { ...remote, annotations: { readOnlyHint: true } },
      arguments: { title: "Hero" },
    }, dependencies);
    expect(proposal).toMatchObject({ status: "pending" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("stores an inert proposal with visible metadata and no bearer data", async () => {
    const { dependencies, execute, repository } = harness();
    const proposal = await createProposal(dependencies);
    expect(proposal).toMatchObject({
      kind: "outbound_mcp",
      status: "pending",
      connection: { id: connection.id, name: "Paper" },
      remoteTool: { name: "create_frame" },
      arguments: { title: "Hero" },
    });
    expect(JSON.stringify(proposal)).not.toContain(connection.token);
    expect(JSON.stringify(proposal)).not.toContain(connection.url);
    expect(repository.rows.get(proposal.id)?.status).toBe("pending");
    expect(repository.rows.get(proposal.id)?.metadata).toMatchObject({
      definitionFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      connectionFingerprint: "connection-fingerprint-original",
      remoteDefinition: {
        name: "create_frame",
        description: remote.description,
        inputSchema: remote.inputSchema,
        annotations: remote.annotations,
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes once after approval and returns an external receipt", async () => {
    const { dependencies, execute } = harness();
    const proposal = await createProposal(dependencies);
    const result = await decideOutboundMcpProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result).toMatchObject({
      status: "completed",
      receipt: {
        kind: "outbound_mcp",
        tool: "create_frame",
        connection: { id: connection.id, name: "Paper" },
        text: "Frame 7",
      },
    });
    expect(execute).toHaveBeenCalledWith(
      owner,
      connection,
      expect.objectContaining({ name: "create_frame" }),
      { title: "Hero" },
      proposal.id,
    );
    const replay = await decideOutboundMcpProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(replay).toEqual(result);
    const staleDenial = await decideOutboundMcpProposal(
      { actor: owner, proposalId: proposal.id, decision: "deny" },
      dependencies,
    );
    expect(staleDenial).toEqual(result);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not disguise receipt storage failure as remote execution failure", async () => {
    const { dependencies, execute, repository } = harness();
    const proposal = await createProposal(dependencies);
    repository.rejectCompletion = true;
    const result = await decideOutboundMcpProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result).toMatchObject({
      status: "ambiguous",
      message: expect.stringMatching(/tool completed.*verify the result/i),
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(repository.rows.get(proposal.id)?.status).toBe("failed");
    await expect(decideOutboundMcpProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    )).resolves.toMatchObject({ status: "ambiguous" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("reports a remote result with missing audit as terminal ambiguity", async () => {
    const { dependencies, execute, repository } = harness();
    const proposal = await createProposal(dependencies);
    execute.mockRejectedValueOnce(new OutboundExecutionAmbiguousError({
      status: "ok",
      text: "Frame 7",
    }));
    const result = await decideOutboundMcpProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result).toMatchObject({
      status: "ambiguous",
      message: expect.stringMatching(/may have completed.*verify/i),
    });
    expect(repository.rows.get(proposal.id)?.status).toBe("failed");
  });

  it("denial is final and never contacts the remote server", async () => {
    const { dependencies, execute } = harness();
    const proposal = await createProposal(dependencies);
    expect((await decideOutboundMcpProposal(
      { actor: owner, proposalId: proposal.id, decision: "deny" },
      dependencies,
    )).status).toBe("denied");
    expect((await decideOutboundMcpProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    )).status).toBe("denied");
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed for expiry and another workspace", async () => {
    const expired = harness();
    const proposal = await createOutboundMcpProposal(
      { actor: owner, connection, remote, arguments: { title: "Hero" }, ttlMs: 1_000 },
      expired.dependencies,
    );
    expired.advance(1_001);
    expect((await decideOutboundMcpProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      expired.dependencies,
    )).status).toBe("expired");
    expect((await decideOutboundMcpProposal(
      { actor: otherOwner, proposalId: proposal.id, decision: "approve" },
      expired.dependencies,
    )).status).toBe("not_found");
    expect(expired.execute).not.toHaveBeenCalled();
    expect(expired.auditRejected).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ id: "blog-1" }),
      proposal.id,
      "expired",
    );
  });

  it("revalidates stored arguments against rediscovered schema after tampering", async () => {
    const { dependencies, execute, repository, tamperSchema } = harness();
    const proposal = await createProposal(dependencies);
    repository.rows.get(proposal.id)!.arguments = { title: "Injected", extra: true };
    tamperSchema();
    const result = await decideOutboundMcpProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result.status).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a same-name tool whose reviewed definition changed", async () => {
    const { dependencies, execute, replaceSameNameDefinition } = harness();
    const proposal = await createProposal(dependencies);
    replaceSameNameDefinition();
    const result = await decideOutboundMcpProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/changed after review/i),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a destination whose endpoint or credential changed", async () => {
    const { dependencies, execute, replaceConnectionConfiguration } = harness();
    const proposal = await createProposal(dependencies);
    replaceConnectionConfiguration();
    const result = await decideOutboundMcpProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/destination changed after review/i),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed when the connection is disabled or removed", async () => {
    const { dependencies, execute, disableConnection } = harness();
    const proposal = await createProposal(dependencies);
    disableConnection();
    const result = await decideOutboundMcpProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result).toMatchObject({ status: "failed" });
    expect(execute).not.toHaveBeenCalled();
  });
});
