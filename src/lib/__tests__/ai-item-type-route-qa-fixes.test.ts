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


let subject = 0;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ sub: `qa-fix-${subject++}` });
  mocks.getOwnedBlog.mockResolvedValue({ handle: "writer" });
  mocks.getWorkspaceAiConfigForOwner.mockResolvedValue({ provider: "anthropic" });
});
const request = (body: unknown) => new Request("http://local/api/ai/item-type", {
  method: "POST", body: JSON.stringify(body),
});
const invalidFilter = { name: "Numbers", fields: [{ id: "rating", label: "Rating", type: "number" }], collection: { layout: "list", filters: [{ field: "rating", op: "gte", value: "4" }] } };

describe("item-type request and repair boundaries", () => {
  it.each([null, [], true, 4, "prompt"])("rejects a non-object body %j without model use", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).error).toContain("JSON request object");
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
  it("uses the last validation reason after exactly one repair", async () => {
    mocks.generateText.mockResolvedValueOnce({ text: "not JSON" })
      .mockResolvedValueOnce({ text: JSON.stringify(invalidFilter) });
    const response = await POST(request({ prompt: "Numbers" }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/rating.*number/);
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
  });
  it("distinguishes a provider failure during repair from validation exhaustion", async () => {
    mocks.generateText.mockResolvedValueOnce({ text: JSON.stringify(invalidFilter) })
      .mockRejectedValueOnce(new Error("provider private details"));
    const response = await POST(request({ prompt: "Numbers" }));
    const { error } = await response.json();
    expect(response.status).toBe(502);
    expect(error).toContain("AI provider");
    expect(error).not.toMatch(/rating|private details/);
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
  });
});
