import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getOwnedBlog: vi.fn(),
  recordAction: vi.fn(async () => {}),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/store", () => ({ getOwnedBlog: mocks.getOwnedBlog }));
vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction }));

import { POST } from "@/app/api/ai/feedback/route";

function request(body: unknown) {
  return new Request("http://x/api/ai/feedback", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("/api/ai/feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({
      sub: "editor-sub",
      userId: "user-uuid",
    });
    mocks.getOwnedBlog.mockResolvedValue({ handle: "demo-blog" });
  });

  it("requires a signed-in workspace", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await POST(request({ rating: "up" }))).status).toBe(401);
    mocks.getCurrentUser.mockResolvedValue({ sub: "editor-sub", userId: null });
    mocks.getOwnedBlog.mockResolvedValue(null);
    expect((await POST(request({ rating: "up" }))).status).toBe(403);
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });

  it("records a content-blind thumbs rating", async () => {
    const response = await POST(
      request({ rating: "down", provider: "Anthropic", messageId: "m123" }),
    );
    expect(response.status).toBe(204);
    expect(mocks.recordAction).toHaveBeenCalledWith({
      actorUserId: "user-uuid",
      actorType: "human",
      actionName: "ai.answer_feedback",
      targetType: "mode",
      targetId: "m123",
      inputSummary: "down · Anthropic",
      outputSummary: "demo-blog",
    });
  });

  it("rejects ratings outside the two visible choices", async () => {
    expect((await POST(request({ rating: "maybe" }))).status).toBe(400);
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });
});
