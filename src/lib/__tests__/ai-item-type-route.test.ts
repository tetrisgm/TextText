import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  getCurrentUser: vi.fn(),
  getOwnedBlog: vi.fn(),
  getPostById: vi.fn(),
  getDocumentTemplateForHandle: vi.fn(),
  getWorkspaceAiConfigForOwner: vi.fn(),
  recordWorkspaceAiResult: vi.fn(),
  workspaceLanguageModel: vi.fn(() => "language-model"),
}));

vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/store", () => ({ getOwnedBlog: mocks.getOwnedBlog, getPostById: mocks.getPostById, getDocumentTemplateForHandle: mocks.getDocumentTemplateForHandle }));
vi.mock("@/lib/ai/workspace-ai-config.server", () => ({
  getWorkspaceAiConfigForOwner: mocks.getWorkspaceAiConfigForOwner,
  recordWorkspaceAiResult: mocks.recordWorkspaceAiResult,
}));
vi.mock("@/lib/ai/provider-model.server", () => ({
  workspaceLanguageModel: mocks.workspaceLanguageModel,
}));

import { POST } from "@/app/api/ai/item-type/route";

const blueprint = {
  name: "Project tasks",
  description: "Tasks grouped by progress.",
  styleReference: "Notion",
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
    body: JSON.stringify(body && typeof body === "object" && !Array.isArray(body) ? { workspaceHandle: "writer", ...body } : body),
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

let subject = 0;
describe("/api/ai/item-type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ sub: `owner-sub-${subject++}` });
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

  it("hands the model a worked example near the request", async () => {
    // The selector is unit tested on its own. This is the other half, and the
    // half that was missing: proof the block reaches the prompt. Without it,
    // deleting the call site would leave every test green.
    mocks.generateText.mockResolvedValue({ text: JSON.stringify(blueprint) });
    await POST(
      request({
        prompt:
          "Make this a to-do list like Todoist: each task has a checkbox, a due date and a priority.",
      }),
    );
    const { prompt } = mocks.generateText.mock.calls[0][0];
    expect(prompt).toContain("Item types that already exist here");
    expect(prompt).toContain("Example: Tasks");
    expect(prompt).toContain("Fields:");
  });

  it("says nothing rather than offering a misleading neighbour", async () => {
    mocks.generateText.mockResolvedValue({ text: JSON.stringify(blueprint) });
    await POST(request({ prompt: "zzzqqq wibble frobnicate" }));
    const { prompt } = mocks.generateText.mock.calls[0][0];
    expect(prompt).not.toContain("Item types that already exist here");
    expect(prompt).toContain("Writer request:");
  });

  it("passes the current validated design into a refinement", async () => {
    await POST(request({ prompt: "Add priority", current: blueprint }));
    expect(mocks.generateText.mock.calls[0][0].prompt).toContain(
      "Current design to revise:",
    );
  });

  it("uses the ordinary assistant's Auto model selection", async () => {
    const response = await POST(request({ model: "auto", prompt: "Research this reader layout" }));
    expect(response.status).toBe(200);
    expect((await response.json()).model).toBe("claude-sonnet-5");
    expect(mocks.workspaceLanguageModel).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-sonnet-5" }));
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

  it.each(["enum", "reference"])("repairs unsupported multi-select %s rows and includes legacy source in the request", async (type) => {
    mocks.getCurrentUser.mockResolvedValue({ sub: `row-repair-${type}` });
    const invalid = { ...blueprint, fields: [...blueprint.fields, {
      id: "entries", label: "Entries", type: "rows", fields: [{
        id: "tags", label: "Tags", type, multiple: true,
        ...(type === "enum" ? { options: [{ value: "a", label: "A" }] } : {}),
      }],
    }] };
    mocks.generateText
      .mockResolvedValueOnce({ text: JSON.stringify(invalid) })
      .mockResolvedValueOnce({ text: JSON.stringify(blueprint) });
    const response = await POST(request({ prompt: "Correct the source tags", current: invalid }));
    expect(response.status).toBe(200);
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.generateText.mock.calls[0][0].prompt).toContain("Current design to revise:");
    expect(mocks.generateText.mock.calls[0][0].prompt).toContain('"multiple":true');
    const repair = mocks.generateText.mock.calls[1][0].prompt;
    expect(repair).toContain('Row field "entries.tags" cannot use multiple: true');
    expect(repair).toContain("Set multiple to false or omit it");
    expect(repair).toContain("one row per value");
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
          display: "auto",
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

    mocks.getCurrentUser.mockResolvedValue({ sub: `owner-sub-${subject++}` });
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

  it("preserves the first preview while recording a rejected optional provider pass", async () => {
    const incomplete = { ...blueprint, fields: [...blueprint.fields,
      { id: "statusNote", label: "Status", type: "text", display: "auto" }] };
    mocks.generateText.mockResolvedValueOnce({ text: JSON.stringify(incomplete) })
      .mockRejectedValueOnce({ statusCode: 401, responseBody: '{"error":{"type":"authentication_error"}}' });
    const response = await POST(request({ prompt: "A task board" }));
    expect(response.status).toBe(200);
    expect((await response.json()).blueprint.name).toBe("Project tasks");
    expect(mocks.recordWorkspaceAiResult).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ code: "authentication" }), "claude-sonnet-5");
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

  it("binds provider use to the requested workspace", async () => {
    const response = await POST(request({ workspaceHandle: "someone-else", prompt: "A board" }));
    expect(response.status).toBe(403);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("classifies an authentication rejection and invalidates the exact configuration", async () => {
    const id = "27aa246c-5c98-4161-b50d-27a6fd66b072";
    mocks.generateText.mockRejectedValue({ statusCode: 401, responseBody: '{"error":{"type":"authentication_error","message":"private-key-value private-body"}}', responseHeaders: { "request-id": "req_1234567890" } });
    const input = request({ prompt: "A board" });
    input.headers.set("x-texttext-request-id", id);
    const response = await POST(input);
    expect(response.status).toBe(502);
    expect(response.headers.get("x-texttext-request-id")).toBe(id);
    const data = await response.json();
    expect(data.failure).toMatchObject({ code: "authentication", requestId: id, upstreamStatus: 401, upstreamRequestId: "req_1234567890" });
    expect(JSON.stringify(data)).not.toMatch(/private-key-value|private-body/);
    expect(mocks.recordWorkspaceAiResult).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ code: "authentication" }), "claude-sonnet-5");
  });

  it("cancels without a provider call or late preview", async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await POST(new Request(request({ prompt: "A board" }), { signal: controller.signal }));
    expect(response.status).toBe(499);
    expect((await response.json()).failure.code).toBe("cancelled");
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("grounds a document preview in the exact authoritative item and refuses stale content", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
    document.content.title = "Selected actual item";
    document.content.body = "Keep **this Markdown** intact.";
    mocks.getPostById.mockResolvedValue({ id, revision: 7, document });
    mocks.getDocumentTemplateForHandle.mockResolvedValue({ id: "texttext.note", version: 1 });
    const stale = await POST(request({ targetPostId: id, expectedRevision: 6, prompt: "Make a reader" }));
    expect(stale.status).toBe(409);
    expect(mocks.generateText).not.toHaveBeenCalled();
    const response = await POST(request({ targetPostId: id, expectedRevision: 7, prompt: "Make a reader" }));
    expect(response.status).toBe(200);
    expect(mocks.getPostById).toHaveBeenLastCalledWith("writer", id);
    expect(mocks.generateText.mock.calls[0][0].prompt).toContain("Keep **this Markdown** intact.");
    expect(mocks.generateText.mock.calls[0][0].prompt).toContain("Selected actual item");
  });

  it("never spends on a document outside the owned workspace", async () => {
    mocks.getPostById.mockResolvedValue(null);
    const response = await POST(request({ targetPostId: "00000000-0000-4000-8000-000000000001", expectedRevision: 1, prompt: "Make a reader" }));
    expect(response.status).toBe(403);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});

// Round 7 QA: valid JSON is not necessarily a request object.
it("P2: returns a plain 400 for JSON null", async () => {
  mocks.getCurrentUser.mockResolvedValue({ sub: "round7-null" });
  mocks.getOwnedBlog.mockResolvedValue({ handle: "writer" });
  mocks.getWorkspaceAiConfigForOwner.mockResolvedValue({ provider: "anthropic", model: "claude-sonnet-5" });
  const response = await POST(request(null));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/describe|JSON|request/i);
});

it("P3: exhausted compilation repair explains the field problem instead of blaming prompt length", async () => {
  mocks.getCurrentUser.mockResolvedValue({ sub: "round7-exhausted" });
  mocks.getOwnedBlog.mockResolvedValue({ handle: "writer" });
  mocks.getWorkspaceAiConfigForOwner.mockResolvedValue({ provider: "anthropic", model: "claude-sonnet-5" });
  const invalid = { name: "Sources", fields: [{ id: "entries", label: "Entries", type: "rows", fields: [{ id: "tags", label: "Tags", type: "enum", multiple: true, options: [{ value: "a", label: "A" }] }] }], collection: { layout: "list" } };
  mocks.generateText.mockReset().mockResolvedValue({ text: JSON.stringify(invalid) });
  const response = await POST(request({ prompt: "Multiple tags on each source" }));
  expect(response.status).toBe(502);
  expect(mocks.generateText).toHaveBeenCalledTimes(2);
  const { error } = await response.json();
  expect(error).toMatch(/row|single value|entries.tags/i);
  expect(error).not.toContain("shorter description");
});
