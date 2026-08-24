import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProposal: vi.fn(),
}));

vi.mock("@/lib/ai/outbound-proposals.server", () => ({
  createOutboundMcpProposal: mocks.createProposal,
}));

import { guardedOutboundAssistantTools } from "@/lib/ai/outbound-tools";

const actor = { sub: "owner-sub", userId: "user-1", handle: "alpha" };
const connection = {
  id: "connection-1",
  name: "Paper",
  url: "https://paper.example/mcp",
  token: null,
};
const schema = { type: "object", properties: {} };

type ExecutableTool = {
  execute?: (args: unknown, options: never) => Promise<unknown>;
};

async function executeTool(tool: unknown, args: unknown) {
  const execute = (tool as ExecutableTool).execute;
  if (!execute) throw new Error("Tool is not executable");
  return execute(args, undefined as never);
}

describe("guarded outbound assistant tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createProposal.mockResolvedValue({
      id: "proposal-1",
      kind: "outbound_mcp",
      status: "pending",
      tool: "create_frame",
      title: "Run a tool on Paper",
      summary: "Create frame on Paper",
      arguments: { title: "Hero" },
      connection: { id: connection.id, name: connection.name },
      remoteTool: {
        name: "create_frame",
        description: "Create a frame",
        annotations: {},
      },
      createdAt: "2026-08-24T12:00:00.000Z",
      expiresAt: "2026-08-24T12:15:00.000Z",
    });
  });

  it.each([
    ["missing", undefined],
    ["explicit false", { readOnlyHint: false }],
    ["claimed read-only", { readOnlyHint: true }],
    ["destructive", { readOnlyHint: false, destructiveHint: true }],
    ["contradictory", { readOnlyHint: true, destructiveHint: true }],
  ])("stages %s metadata without calling the server", async (_label, annotations) => {
    const onProposal = vi.fn();
    const tools = guardedOutboundAssistantTools(
      actor,
      [{
        connection,
        tools: [{
          name: "create_frame",
          description: "Create a frame",
          inputSchema: schema,
          ...(annotations ? { annotations } : {}),
        }],
      }],
      onProposal,
    );
    const output = await executeTool(tools.paper__create_frame, { title: "Hero" });
    expect(String(output)).toContain('"approval_required":true');
    expect(mocks.createProposal).toHaveBeenCalled();
    expect(onProposal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "outbound_mcp", status: "pending" }),
    );
  });
});
