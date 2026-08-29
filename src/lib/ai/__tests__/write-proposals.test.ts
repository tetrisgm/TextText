import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceWriteProposal,
  decideWorkspaceWriteProposal,
  type StoredWorkspaceWriteProposal,
  type WorkspaceWriteProposalBinding,
  type WorkspaceWriteProposalDependencies,
  type WorkspaceWriteProposalRepository,
  type AssistantProposalReceipt,
} from "@/lib/ai/write-proposals.server";
import { WriteProposalValidationError } from "@/lib/ai/write-proposal-policy";

class MemoryProposalRepository implements WorkspaceWriteProposalRepository {
  rows = new Map<string, StoredWorkspaceWriteProposal>();
  rejectCompletion = false;

  async create(proposal: StoredWorkspaceWriteProposal) {
    this.rows.set(proposal.id, structuredClone(proposal));
  }

  async get(id: string, binding: WorkspaceWriteProposalBinding) {
    const row = this.bound(id, binding);
    return row ? structuredClone(row) : null;
  }

  private bound(id: string, binding: WorkspaceWriteProposalBinding) {
    const row = this.rows.get(id);
    return row &&
      row.blogId === binding.blogId &&
      row.actorUserId === binding.actorUserId
      ? row
      : null;
  }

  async claim(id: string, binding: WorkspaceWriteProposalBinding, now: Date) {
    const row = this.bound(id, binding);
    if (
      !row ||
      row.status !== "pending" ||
      row.expiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }
    row.status = "executing";
    return structuredClone(row);
  }

  async deny(id: string, binding: WorkspaceWriteProposalBinding, now: Date) {
    const row = this.bound(id, binding);
    if (
      !row ||
      row.status !== "pending" ||
      row.expiresAt.getTime() <= now.getTime()
    ) {
      return false;
    }
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

function harness() {
  const repository = new MemoryProposalRepository();
  let clock = new Date("2026-08-24T12:00:00.000Z");
  const execute = vi.fn(async () => ({
    content: [{ type: "text", text: '{"item":{"id":"item-1"}}' }],
    structuredContent: { item: { id: "item-1", hash: "sha256:abc" } },
  }));
  const dependencies: WorkspaceWriteProposalDependencies = {
    repository,
    resolveWorkspace: vi.fn(async (handle) =>
      handle === "alpha"
        ? { id: "blog-1", handle, ownerId: "user-1" }
        : handle === "beta"
          ? { id: "blog-2", handle, ownerId: "user-2" }
          : null,
    ),
    execute,
    now: () => new Date(clock),
    randomId: () => "11111111-1111-4111-8111-111111111111",
    resolveItems: async () => new Map(),
  };
  return {
    repository,
    dependencies,
    execute,
    advance(milliseconds: number) {
      clock = new Date(clock.getTime() + milliseconds);
    },
  };
}

async function createCapture(
  dependencies: WorkspaceWriteProposalDependencies,
) {
  return createWorkspaceWriteProposal(
    {
      actor: owner,
      tool: "create_item",
      arguments: { capture: "A durable private note" },
    },
    dependencies,
  );
}

describe("workspace write proposals", () => {
  it("validates and stores an inert bounded proposal without executing", async () => {
    const { dependencies, execute, repository } = harness();
    const proposal = await createCapture(dependencies);
    expect(proposal).toMatchObject({
      status: "pending",
      tool: "create_item",
      title: "Create item",
      arguments: { capture: "A durable private note" },
    });
    expect(repository.rows.get(proposal.id)?.status).toBe("pending");
    expect(execute).not.toHaveBeenCalled();
  });

  it("claims once, executes the stored arguments, and returns an authoritative receipt", async () => {
    const { dependencies, execute, repository } = harness();
    const proposal = await createCapture(dependencies);
    const result = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result).toMatchObject({
      status: "completed",
      receipt: {
        proposalId: proposal.id,
        tool: "create_item",
        output: { item: { id: "item-1", hash: "sha256:abc" } },
      },
    });
    expect(execute).toHaveBeenCalledWith(
      "create_item",
      { capture: "A durable private note" },
      owner,
    );
    expect(repository.rows.get(proposal.id)?.status).toBe("completed");
  });

  it("reports a successful mutation truthfully when receipt storage fails", async () => {
    const { dependencies, execute, repository } = harness();
    const proposal = await createCapture(dependencies);
    repository.rejectCompletion = true;
    const result = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result).toMatchObject({
      status: "ambiguous",
      message: expect.stringMatching(/change completed.*verify the result/i),
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(repository.rows.get(proposal.id)?.status).toBe("failed");
    await expect(decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    )).resolves.toMatchObject({ status: "ambiguous" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns the authoritative receipt to a stale approval or denial", async () => {
    const { dependencies, execute } = harness();
    const proposal = await createCapture(dependencies);
    const completed = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    const staleApproval = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    const staleDenial = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "deny" },
      dependencies,
    );
    expect(staleApproval).toEqual(completed);
    expect(staleDenial).toEqual(completed);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not reveal or execute another workspace's proposal", async () => {
    const { dependencies, execute } = harness();
    const proposal = await createCapture(dependencies);
    const result = await decideWorkspaceWriteProposal(
      { actor: otherOwner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result.status).toBe("not_found");
    expect(execute).not.toHaveBeenCalled();
  });

  it("expires without executing", async () => {
    const { dependencies, execute, advance } = harness();
    const proposal = await createWorkspaceWriteProposal(
      {
        actor: owner,
        tool: "create_item",
        arguments: { capture: "Short lived" },
        ttlMs: 1_000,
      },
      dependencies,
    );
    advance(1_001);
    const result = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result.status).toBe("expired");
    expect(execute).not.toHaveBeenCalled();
  });

  it("denial is final and never mutates workspace content", async () => {
    const { dependencies, execute } = harness();
    const proposal = await createCapture(dependencies);
    const denied = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "deny" },
      dependencies,
    );
    const laterApproval = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(denied.status).toBe("denied");
    expect(laterApproval.status).toBe("denied");
    expect(execute).not.toHaveBeenCalled();
  });

  it("revalidates the stored payload and fails closed after tampering", async () => {
    const { dependencies, execute, repository } = harness();
    const proposal = await createCapture(dependencies);
    const stored = repository.rows.get(proposal.id)!;
    stored.arguments = { ...stored.arguments, unvalidated: "injected" };
    const result = await decideWorkspaceWriteProposal(
      { actor: owner, proposalId: proposal.id, decision: "approve" },
      dependencies,
    );
    expect(result.status).toBe("failed");
    expect(repository.rows.get(proposal.id)?.status).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["delete_item", "add_item_asset"])(
    "never stages excluded %s actions",
    async (tool) => {
      const { dependencies, execute } = harness();
      await expect(
        createWorkspaceWriteProposal(
          { actor: owner, tool, arguments: {} },
          dependencies,
        ),
      ).rejects.toMatchObject({
        code: "tool_not_safe",
      } satisfies Partial<WriteProposalValidationError>);
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
