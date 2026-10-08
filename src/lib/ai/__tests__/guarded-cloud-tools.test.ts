import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProposal: vi.fn(),
  runWorkspaceToolForSession: vi.fn(),
}));

vi.mock("@/lib/ai/write-proposals.server", () => ({
  createWorkspaceWriteProposal: mocks.createProposal,
}));
vi.mock("@/lib/mcp/tools", () => ({
  runWorkspaceToolForSession: mocks.runWorkspaceToolForSession,
}));

import { cloudAssistantTools, guardedCloudAssistantTools } from "@/lib/ai/cloud-tools";
import { folderAgentAllowsTool, ROOT_TEMPLATE_AGENT_TOOLS } from "@/lib/ai/folder-agent-boundary";

const actor = {
  sub: "owner-sub",
  userId: "user-1",
  handle: "alpha",
};

type ExecutableTool = {
  execute?: (args: unknown, options: never) => Promise<unknown>;
};

async function executeTool(tool: unknown, args: unknown) {
  const execute = (tool as ExecutableTool).execute;
  if (!execute) throw new Error("Tool is not executable");
  return execute(args, undefined as never);
}

describe("guarded cloud assistant tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createProposal.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      status: "pending",
      tool: "create_item",
      title: "Create item",
      summary: "Create item",
      arguments: { capture: "Keep this" },
      createdAt: "2026-08-24T12:00:00.000Z",
      expiresAt: "2026-08-24T12:15:00.000Z",
    });
    mocks.runWorkspaceToolForSession.mockResolvedValue({
      content: [{ type: "text", text: "Workspace read" }],
      structuredContent: { ok: true },
    });
  });

  it("offers only explicitly folder-authorized tools for a folder task", () => {
    const tools = guardedCloudAssistantTools({...actor, folderAgentPath: "Notes"}, vi.fn());
    expect(tools).toHaveProperty("read_item");
    expect(tools).toHaveProperty("create_item");
    expect(tools).not.toHaveProperty("get_workspace");
    expect(tools).not.toHaveProperty("create_item_type");
    expect(tools).not.toHaveProperty("move_folder_tree");
  });

  it("offers workspace template commands only to a root folder task in both adapters", () => {
    for (const tools of [cloudAssistantTools({...actor, folderAgentPath: ""}), guardedCloudAssistantTools({...actor, folderAgentPath: ""}, vi.fn())]) {
      for (const name of ROOT_TEMPLATE_AGENT_TOOLS) expect(tools).toHaveProperty(name);
      expect(tools).not.toHaveProperty("move_folder_tree");
    }
    for (const folder of ["Notes", "Templates", "../", null, undefined]) {
      for (const name of ROOT_TEMPLATE_AGENT_TOOLS) expect(folderAgentAllowsTool(folder, name)).toBe(false);
    }
    const readOnly = guardedCloudAssistantTools({...actor, folderAgentPath: ""}, vi.fn(), undefined, "read_only");
    expect(readOnly).toHaveProperty("list_document_templates");
    for (const name of ROOT_TEMPLATE_AGENT_TOOLS) if (name !== "list_document_templates") expect(readOnly).not.toHaveProperty(name);
  });

  it("records a failed command with the executor's own message", async () => {
    // The failure used to be thrown and forgotten. Nothing reached the client,
    // so the turn was labelled Done and the only account of the failure on
    // screen was the model's prose retelling of it.
    mocks.runWorkspaceToolForSession.mockResolvedValue({
      isError: true,
      content: [
        {
          type: "text",
          text: 'Kind "note" does not belong in "blog", which holds article, media_post, or video_post items.',
        },
      ],
    });
    const onWorkspaceCall = vi.fn();
    const tools = guardedCloudAssistantTools(actor, vi.fn(), onWorkspaceCall);

    await expect(
      executeTool(tools.read_item, { item_id: "missing" }),
    ).rejects.toThrow(/does not belong/);

    expect(onWorkspaceCall).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "read_item",
        status: "failed",
        error:
          'Kind "note" does not belong in "blog", which holds article, media_post, or video_post items.',
      }),
    );
  });

  it("marks a command that worked as ok", async () => {
    const onWorkspaceCall = vi.fn();
    const tools = guardedCloudAssistantTools(actor, vi.fn(), onWorkspaceCall);

    await executeTool(tools.read_item, { item_id: "present" });

    expect(onWorkspaceCall).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "read_item", status: "ok" }),
    );
  });

  it("stages previewable edits and confirmations but omits unbounded open-world writes", () => {
    const tools = guardedCloudAssistantTools(actor, vi.fn());
    expect(tools).toHaveProperty("create_item");
    expect(tools).toHaveProperty("read_item");
    expect(tools).toHaveProperty("update_item");
    expect(tools).toHaveProperty("delete_item");
    expect(tools).not.toHaveProperty("set_item_status");
    expect(tools).toHaveProperty("add_item_asset");
    expect(tools).not.toHaveProperty("recapture_item");
  });

  it("stages image imports for explicit approval without executing or fetching", async () => {
    const onProposal = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const args = { id: "item-1", source_url: "https://texttext.app/image.png", placement: "gallery", if_match_hash: "abc", idempotency_key: "image-1" };
    mocks.createProposal.mockResolvedValueOnce({ id: "proposal-image", tool: "add_item_asset", status: "pending", arguments: args });
    try {
      const tools = guardedCloudAssistantTools(actor, onProposal);
      const output = await executeTool(tools.add_item_asset, args);
      expect(mocks.createProposal).toHaveBeenCalledWith({ actor, tool: "add_item_asset", arguments: args });
      expect(onProposal).toHaveBeenCalledWith(expect.objectContaining({ tool: "add_item_asset", status: "pending" }));
      expect(String(output)).toContain('"approval_required":true');
      expect(mocks.runWorkspaceToolForSession).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it("turns a write tool call into a pending proposal without executing", async () => {
    const onProposal = vi.fn();
    const tools = guardedCloudAssistantTools(actor, onProposal);
    const output = await executeTool(tools.create_item, {
      capture: "Keep this",
    });
    expect(mocks.createProposal).toHaveBeenCalledWith({
      actor,
      tool: "create_item",
      arguments: { capture: "Keep this" },
    });
    expect(onProposal).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", tool: "create_item" }),
    );
    expect(String(output)).toContain('"approval_required":true');
    expect(mocks.runWorkspaceToolForSession).not.toHaveBeenCalled();
  });

  it("turns a full content edit into a pending proposal without executing", async () => {
    mocks.createProposal.mockResolvedValueOnce({
      id: "22222222-2222-4222-8222-222222222222",
      status: "pending",
      tool: "update_item",
      title: "Update item",
      summary: "Update item: item-1, 12 characters",
      arguments: {
        id: "item-1",
        body: "Revised body",
        if_match_hash: "sha256:abc",
      },
      createdAt: "2026-08-24T12:00:00.000Z",
      expiresAt: "2026-08-24T12:15:00.000Z",
    });
    const onProposal = vi.fn();
    const tools = guardedCloudAssistantTools(actor, onProposal);

    await executeTool(tools.update_item, {
      id: "item-1",
      body: "Revised body",
      if_match_hash: "sha256:abc",
    });

    expect(onProposal).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", tool: "update_item" }),
    );
    expect(mocks.runWorkspaceToolForSession).not.toHaveBeenCalled();
  });

  it("continues to execute reads through the canonical command surface", async () => {
    const tools = guardedCloudAssistantTools(actor, vi.fn());
    const output = await executeTool(tools.read_item, { id: "item-1" });
    expect(output).toBe("Workspace read");
    expect(mocks.runWorkspaceToolForSession).toHaveBeenCalledWith(
      "read_item",
      { id: "item-1" },
      actor,
    );
    expect(mocks.createProposal).not.toHaveBeenCalled();
  });
});
