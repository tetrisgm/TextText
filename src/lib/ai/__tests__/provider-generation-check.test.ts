import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generateText: vi.fn(), model: vi.fn(() => "selected-model") }));
vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("@/lib/ai/provider-model.server", () => ({ workspaceLanguageModel: mocks.model }));
vi.mock("@/lib/db/client", () => ({ db: null }));
import { validateWorkspaceAiConnection } from "../workspace-ai-config.server";

describe("connection proof uses generation", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.generateText.mockResolvedValue({ text: "OK" }); });
  afterEach(() => vi.unstubAllEnvs());
  it("checks the explicit provider/key/model via the real generation adapter", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TEXTTEXT_DEV_AI_KEY", "different-development-key");
    await validateWorkspaceAiConnection("anthropic", "claude-sonnet-5", "explicit-key");
    expect(mocks.model).toHaveBeenCalledWith({ provider: "anthropic", model: "claude-sonnet-5", apiKey: "explicit-key" }, { useDevelopmentOverride: false });
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ model: "selected-model", maxRetries: 0, maxOutputTokens: 32, abortSignal: expect.any(AbortSignal) }));
    expect(mocks.generateText.mock.calls[0][0].prompt).toBe("Reply with the single word OK.");
  });
  it("rejects an accepted metadata key when generation is rejected without logging it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.generateText.mockRejectedValue({ statusCode: 401, responseBody: '{"error":{"type":"authentication_error","message":"sk-private Private document body"}}' });
    await expect(validateWorkspaceAiConnection("openai", "gpt-5.6", "sk-private")).rejects.toMatchObject({ failure: { code: "authentication", upstreamStatus: 401 } });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/sk-private|Private document body/);
    log.mockRestore();
  });
});
