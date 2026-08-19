import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  getCurrentUser: vi.fn(),
  getOwnedBlog: vi.fn(),
  getWorkspaceAiConfigForOwner: vi.fn(),
  workspaceLanguageModel: vi.fn(() => "language-model"),
}));

vi.mock("ai", () => ({ generateObject: mocks.generateObject }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/store", () => ({ getOwnedBlog: mocks.getOwnedBlog }));
vi.mock("@/lib/ai/workspace-ai-config.server", () => ({
  getWorkspaceAiConfigForOwner: mocks.getWorkspaceAiConfigForOwner,
}));
vi.mock("@/lib/ai/provider-model.server", () => ({
  workspaceLanguageModel: mocks.workspaceLanguageModel,
}));

import { POST } from "@/app/api/ai/item-type/route";

const blueprint = {
  name: "Project tasks",
  description: "Tasks grouped by progress.",
  styleReference: "Notion",
  audience: "private",
  fields: [
    {
      id: "status",
      label: "Status",
      type: "enum",
      options: [
        { value: "todo", label: "To do" },
        { value: "done", label: "Done" },
      ],
      display: "badge",
    },
  ],
  item: { shape: "task", showBody: true, showMetadata: false, showTags: false },
  collection: {
    layout: "board",
    columns: 2,
    groupBy: "status",
    summaryFields: ["status"],
    sortBy: "updatedAt",
    sortDirection: "desc",
  },
  theme: {},
};

function request(body: unknown) {
  return new Request("http://local/api/ai/item-type", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("/api/ai/item-type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ sub: "owner-sub" });
    mocks.getOwnedBlog.mockResolvedValue({ handle: "writer" });
    mocks.getWorkspaceAiConfigForOwner.mockResolvedValue({
      provider: "anthropic",
      model: "claude-sonnet-5",
      apiKey: "secret",
    });
    mocks.generateObject.mockResolvedValue({ object: blueprint });
  });

  it("turns one description into a validated blueprint and real template", async () => {
    const response = await POST(
      request({
        prompt: "Make a Notion-style project board with status.",
        folderName: "Projects",
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.blueprint).toMatchObject({
      name: "Project tasks",
      collection: { layout: "board", groupBy: "status" },
    });
    expect(payload.template).toMatchObject({
      id: "preview.item-type",
      collection: {
        layout: "board",
        groupBy: "content.fields.status",
      },
    });
    const call = mocks.generateObject.mock.calls[0][0];
    expect(call.model).toBe("language-model");
    expect(call.prompt).toContain("Destination folder: Projects");
    expect(call.prompt).toContain("Writer request:");
  });

  it("passes the current validated design into a refinement", async () => {
    await POST(request({ prompt: "Add priority", current: blueprint }));
    expect(mocks.generateObject.mock.calls[0][0].prompt).toContain(
      "Current design to revise:",
    );
  });

  it("does not spend a model call without a session, workspace, provider, or prompt", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await POST(request({ prompt: "A board" }))).status).toBe(401);

    mocks.getCurrentUser.mockResolvedValue({ sub: "owner-sub" });
    mocks.getOwnedBlog.mockResolvedValue(null);
    expect((await POST(request({ prompt: "A board" }))).status).toBe(403);

    mocks.getOwnedBlog.mockResolvedValue({ handle: "writer" });
    mocks.getWorkspaceAiConfigForOwner.mockResolvedValue(null);
    expect((await POST(request({ prompt: "A board" }))).status).toBe(404);

    mocks.getWorkspaceAiConfigForOwner.mockResolvedValue({
      provider: "anthropic",
      model: "claude-sonnet-5",
      apiKey: "secret",
    });
    expect((await POST(request({ prompt: "" }))).status).toBe(400);
    expect(mocks.generateObject).not.toHaveBeenCalled();
  });

  it("maps provider failures to a safe error", async () => {
    mocks.generateObject.mockRejectedValue(new Error("provider request id secret"));
    const response = await POST(request({ prompt: "A board" }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).not.toContain("request id");
  });
});
