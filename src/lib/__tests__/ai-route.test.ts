import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn(() => "stop-marker"),
  getCurrentUser: vi.fn(),
  getOwnedBlog: vi.fn(
    async (): Promise<{ handle: string } | null> => ({ handle: "demo-blog" }),
  ),
  getUserIdBySub: vi.fn(async () => "user-uuid"),
  cloudAssistantTools: vi.fn(() => ({ get_workspace: {} })),
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
    process.env.AI_GATEWAY_API_KEY = "test-key";
    mocks.getCurrentUser.mockResolvedValue(user);
    mocks.getOwnedBlog.mockResolvedValue({ handle: "demo-blog" });
    mocks.generateText.mockResolvedValue({ text: "Here is a summary." });
  });
  afterEach(() => {
    delete process.env.AI_GATEWAY_API_KEY;
  });

  it("is disabled (404) when no gateway key is set", async () => {
    delete process.env.AI_GATEWAY_API_KEY;
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
    expect(await res.json()).toEqual({ text: "Here is a summary." });
    // The session actor is threaded into the tool factory.
    expect(mocks.cloudAssistantTools).toHaveBeenCalledWith({
      sub: "editor-sub",
      userId: "user-uuid",
    });
    // Tools + a step bound are passed to the model call.
    const call = mocks.generateText.mock.calls[0][0];
    expect(call.tools).toEqual({ get_workspace: {} });
    expect(call.stopWhen).toBe("stop-marker");
    expect(call.messages).toEqual([
      { role: "user", content: "Summarize my draft" },
    ]);
  });

  it("maps a model failure to 502 without leaking details", async () => {
    mocks.generateText.mockRejectedValue(new Error("gateway exploded"));
    const res = await POST(post(turn));
    expect(res.status).toBe(502);
    expect((await res.json()).error).not.toContain("exploded");
  });

  it("GET reports enabled only when keyed and signed in", async () => {
    expect((await (await GET()).json()).enabled).toBe(true);
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await (await GET()).json()).enabled).toBe(false);
  });
});
