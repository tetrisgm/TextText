import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callRemoteTool: vi.fn(),
  recordAction: vi.fn(),
  recordActionStrict: vi.fn(),
}));

vi.mock("@/lib/mcp/outbound-client", () => ({
  callRemoteTool: mocks.callRemoteTool,
}));
vi.mock("@/lib/audit", () => ({
  recordAction: mocks.recordAction,
  recordActionStrict: mocks.recordActionStrict,
}));

import {
  executeOutboundAssistantTool,
  OutboundExecutionAmbiguousError,
} from "@/lib/ai/outbound-executor.server";

const actor = { userId: "user-1", handle: "alpha" };
const connection = {
  id: "connection-1",
  name: "Paper",
  url: "https://paper.example/mcp",
  token: "secret",
};
const remote = { name: "create_frame" };

describe("canonical outbound assistant executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callRemoteTool.mockResolvedValue({ status: "ok", text: "Frame 7" });
    mocks.recordAction.mockResolvedValue(undefined);
    mocks.recordActionStrict.mockResolvedValue(undefined);
  });

  it("attributes an owner-approved call to the human and proposal", async () => {
    await expect(
      executeOutboundAssistantTool(actor, connection, remote, { title: "Hero" }, {
        approvedProposalId: "proposal-1",
      }),
    ).resolves.toEqual({ status: "ok", text: "Frame 7" });
    expect(mocks.callRemoteTool).toHaveBeenCalledWith(
      connection,
      "create_frame",
      { title: "Hero" },
    );
    expect(mocks.recordActionStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "human",
        actionName: "mcp.outbound_approved_call",
        targetId: "connection-1",
        inputSummary: expect.stringContaining("Proposal: proposal-1"),
      }),
    );
  });

  it("refuses to call externally without a claimed proposal id", async () => {
    await expect(executeOutboundAssistantTool(
      actor,
      connection,
      remote,
      {},
      { approvedProposalId: "" },
    )).rejects.toThrow(/requires a claimed approval proposal/i);
    expect(mocks.callRemoteTool).not.toHaveBeenCalled();
  });

  it("reports a successful remote result with failed audit as ambiguous", async () => {
    mocks.recordActionStrict.mockRejectedValue(new Error("audit unavailable"));
    await expect(
      executeOutboundAssistantTool(actor, connection, remote, {}, {
        approvedProposalId: "proposal-1",
      }),
    ).rejects.toBeInstanceOf(OutboundExecutionAmbiguousError);
    expect(mocks.callRemoteTool).toHaveBeenCalledTimes(1);
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });

  it("audits an approved failure and never records the bearer token", async () => {
    mocks.callRemoteTool.mockRejectedValue(new Error("Paper did not answer."));
    await expect(
      executeOutboundAssistantTool(actor, connection, remote, {}, {
        approvedProposalId: "proposal-1",
      }),
    ).rejects.toThrow("Paper did not answer.");
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "human",
        actionName: "mcp.outbound_approved_call_failed",
      }),
    );
    expect(JSON.stringify([
      ...mocks.recordAction.mock.calls,
      ...mocks.recordActionStrict.mock.calls,
    ])).not.toContain("secret");
  });
});
