import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn(() => "stop-marker"),
  getCurrentUser: vi.fn(),
  getOwnedBlog: vi.fn(
    async (): Promise<{ handle: string } | null> => ({ handle: "demo-blog" }),
  ),
  getUserIdBySub: vi.fn(async () => "user-uuid"),
  cloudAssistantTools: vi.fn(() => ({ get_workspace: {} })),
  getWorkspaceAiConfigForOwner: vi.fn(),
  getWorkspaceAiConfigStatusForOwner: vi.fn(),
  createAnthropic: vi.fn(() => vi.fn(() => "anthropic-model")),
  createOpenAI: vi.fn(() => vi.fn(() => "openai-model")),
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  stepCountIs: mocks.stepCountIs,
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/store", () => ({
  getOwnedBlog: mocks.getOwnedBlog,
  getUserIdBySub: mocks.getUserIdBySub,
}));
vi.mock("@/lib/ai/cloud-tools", () => ({
  cloudAssistantTools: mocks.cloudAssistantTools,
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mocks.createAnthropic,
}));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mocks.createOpenAI }));
vi.mock("@/lib/ai/workspace-ai-config.server", () => ({
  cloudProviderLabel: (provider: string) =>
    provider === "anthropic" ? "Anthropic" : "OpenAI",
  getWorkspaceAiConfigForOwner: mocks.getWorkspaceAiConfigForOwner,
  getWorkspaceAiConfigStatusForOwner:
    mocks.getWorkspaceAiConfigStatusForOwner,
}));

import { GET, POST } from "@/app/api/ai/route";

function post(bodyObj: unknown) {
  return new Request("http://x/api/ai", {
    method: "POST",
    body: JSON.stringify(bodyObj),
  });
}
const user = { sub: "editor-sub", userId: "user-uuid" };
const turn = { messages: [{ role: "user", content: "Summarize my draft" }] };

describe("/api/ai cloud assistant route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(user);
    mocks.getOwnedBlog.mockResolvedValue({ handle: "demo-blog" });
    mocks.getWorkspaceAiConfigForOwner.mockResolvedValue({
      provider: "anthropic",
      model: "claude-sonnet-5",
      apiKey: "workspace-secret-key",
    });
    mocks.getWorkspaceAiConfigStatusForOwner.mockResolvedValue({
      configured: true,
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    mocks.generateText.mockResolvedValue({ text: "Here is a summary." });
  });

  it("is disabled (404) when no workspace provider is connected", async () => {
    mocks.getWorkspaceAiConfigForOwner.mockResolvedValue(null);
    const res = await POST(post(turn));
    expect(res.status).toBe(404);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("requires a session (401)", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await POST(post(turn));
    expect(res.status).toBe(401);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("refuses (403) a signed-in user who owns no workspace, without spending", async () => {
    mocks.getOwnedBlog.mockResolvedValue(null);
    const res = await POST(post(turn));
    expect(res.status).toBe(403);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("rejects an empty message list (400)", async () => {
    const res = await POST(post({ messages: [] }));
    expect(res.status).toBe(400);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("runs a turn with the workspace tools and returns the reply", async () => {
    const res = await POST(post(turn));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: "Here is a summary.",
      provider: "Anthropic",
      model: "claude-sonnet-5",
    });
    // The session actor is threaded into the tool factory.
    expect(mocks.cloudAssistantTools).toHaveBeenCalledWith({
      sub: "editor-sub",
      userId: "user-uuid",
      handle: "demo-blog",
    });
    // Tools + a step bound are passed to the model call.
    const call = mocks.generateText.mock.calls[0][0];
    expect(call.tools).toEqual({ get_workspace: {} });
    expect(call.stopWhen).toBe("stop-marker");
    expect(call.messages).toEqual([
      { role: "user", content: "Summarize my draft" },
    ]);
  });

  it("uses the selected workspace OpenAI model", async () => {
    mocks.getWorkspaceAiConfigForOwner.mockResolvedValue({
      provider: "openai",
      model: "gpt-5.6",
      apiKey: "workspace-secret-key",
    });

    const res = await POST(post(turn));

    expect(res.status).toBe(200);
    expect(mocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: "workspace-secret-key",
    });
    expect(mocks.generateText.mock.calls[0][0].model).toBe("openai-model");
    expect(await res.json()).toEqual({
      text: "Here is a summary.",
      provider: "OpenAI",
      model: "gpt-5.6",
    });
  });

  it("maps a model failure to 502 without leaking details", async () => {
    mocks.generateText.mockRejectedValue(new Error("gateway exploded"));
    const res = await POST(post(turn));
    expect(res.status).toBe(502);
    expect((await res.json()).error).not.toContain("exploded");
  });

  it("GET reports enabled only when keyed and signed in", async () => {
    expect(await (await GET()).json()).toEqual({
      enabled: true,
      provider: "Anthropic",
      model: "claude-sonnet-5",
    });
    mocks.getWorkspaceAiConfigStatusForOwner.mockResolvedValue({
      configured: true,
      provider: "openai",
      model: "gpt-5.6",
    });
    expect(await (await GET()).json()).toEqual({
      enabled: true,
      provider: "OpenAI",
      model: "gpt-5.6",
    });
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await (await GET()).json()).enabled).toBe(false);
  });
});
