import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  getCurrentUser: vi.fn(),
  getOwnedBlog: vi.fn(),
  getWorkspaceAiConfigForOwner: vi.fn(),
  workspaceLanguageModel: vi.fn(() => "language-model"),
}));

vi.mock("ai", () => ({ generateText: mocks.generateText }));
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

function streamedOversizedRequest() {
  const encoder = new TextEncoder();
  const chunk = encoder.encode("x".repeat(600_000));
  return new Request("http://local/api/ai/item-type", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
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
    mocks.generateText.mockResolvedValue({ text: JSON.stringify(blueprint) });
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
    const call = mocks.generateText.mock.calls[0][0];
    expect(call.model).toBe("language-model");
    expect(call.prompt).toContain("Destination folder: Projects");
    expect(call.prompt).toContain("Writer request:");
  });

  it("passes the current validated design into a refinement", async () => {
    await POST(request({ prompt: "Add priority", current: blueprint }));
    expect(mocks.generateText.mock.calls[0][0].prompt).toContain(
      "Current design to revise:",
    );
  });

  it("repairs invalid model JSON once before failing the request", async () => {
    mocks.generateText
      .mockResolvedValueOnce({ text: "{}" })
      .mockResolvedValueOnce({ text: JSON.stringify(blueprint) });

    const response = await POST(request({ prompt: "A task board" }));
    expect(response.status).toBe(200);
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.generateText.mock.calls[1][0].prompt).toContain(
      "Correct the generated JSON",
    );
  });

  it("repairs a schema-valid blueprint whose field relationships cannot compile", async () => {
    const duplicateFields = {
      ...blueprint,
      fields: [...blueprint.fields, { ...blueprint.fields[0] }],
    };
    mocks.generateText
      .mockResolvedValueOnce({ text: JSON.stringify(duplicateFields) })
      .mockResolvedValueOnce({ text: JSON.stringify(blueprint) });

    const response = await POST(request({ prompt: "A task board" }));

    expect(response.status).toBe(200);
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.generateText.mock.calls[1][0].prompt).toContain(
      "Item type field ids must be unique",
    );
  });

  it("keeps a safe first draft when the optional quality revision is malformed", async () => {
    const incomplete = {
      ...blueprint,
      fields: [
        ...blueprint.fields,
        {
          id: "statusNote",
          label: "Status",
          type: "text",
          display: "fact",
        },
      ],
    };
    mocks.generateText
      .mockResolvedValueOnce({ text: JSON.stringify(incomplete) })
      .mockResolvedValueOnce({ text: "not json" });

    const response = await POST(request({ prompt: "A task board" }));

    expect(response.status).toBe(200);
    expect((await response.json()).blueprint).toMatchObject({
      name: "Project tasks",
      collection: { layout: "board", groupBy: "status" },
    });
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.generateText.mock.calls[1][0].prompt).toContain(
      "Improve this reusable item-type blueprint",
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
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("rejects declared and streamed oversized requests without spending", async () => {
    const declared = request({ prompt: "A board" });
    declared.headers.set("content-length", "1100001");
    const declaredResponse = await POST(declared);
    expect(declaredResponse.status).toBe(413);
    expect(declaredResponse.headers.get("cache-control")).toContain("no-store");

    const streamedResponse = await POST(streamedOversizedRequest());
    expect(streamedResponse.status).toBe(413);
    expect(streamedResponse.headers.get("cache-control")).toContain("no-store");
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("maps provider failures to a safe error", async () => {
    mocks.generateText.mockRejectedValue(new Error("provider request id secret"));
    const response = await POST(request({ prompt: "A board" }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).not.toContain("request id");
  });
});
