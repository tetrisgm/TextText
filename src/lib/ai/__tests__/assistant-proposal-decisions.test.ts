import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  outbound: vi.fn(),
}));

vi.mock("@/lib/ai/write-proposals.server", () => ({
  decideWorkspaceWriteProposal: mocks.workspace,
}));
vi.mock("@/lib/ai/outbound-proposals.server", () => ({
  decideOutboundMcpProposal: mocks.outbound,
}));

import { decideAssistantProposal } from "@/lib/ai/assistant-proposal-decisions.server";

const input = {
  actor: { sub: "owner-sub", userId: "user-1", handle: "alpha" },
  proposalId: "proposal-1",
  decision: "approve" as const,
};

describe("assistant proposal decision dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspace.mockResolvedValue({
      status: "not_found",
      proposalId: "proposal-1",
    });
    mocks.outbound.mockResolvedValue({
      status: "completed",
      receipt: { kind: "outbound_mcp" },
    });
  });

  it("dispatches an opaque non-workspace proposal to the outbound service", async () => {
    await expect(decideAssistantProposal(input)).resolves.toMatchObject({
      status: "completed",
      receipt: { kind: "outbound_mcp" },
    });
    expect(mocks.outbound).toHaveBeenCalledWith(input);
  });

  it("does not offer an already-resolved workspace proposal to another executor", async () => {
    mocks.workspace.mockResolvedValue({
      status: "completed",
      receipt: { kind: "workspace" },
    });
    await expect(decideAssistantProposal(input)).resolves.toMatchObject({
      receipt: { kind: "workspace" },
    });
    expect(mocks.outbound).not.toHaveBeenCalled();
  });
});
