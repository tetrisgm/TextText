import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiConnectionError, aiFailure } from "@/lib/ai/provider-failure";

const mocks = vi.hoisted(() => ({
  getBlogEditAccess: vi.fn(),
  getStatus: vi.fn(),
  recordAction: vi.fn(),
  removeConfig: vi.fn(),
  saveConfig: vi.fn(),
  validateConnection: vi.fn(),
}));

vi.mock("@/lib/blog-edit-auth", () => ({
  getBlogEditAccess: mocks.getBlogEditAccess,
}));
vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction }));
vi.mock("@/lib/ai/workspace-ai-config.server", () => ({
  getWorkspaceAiConfigStatus: mocks.getStatus,
  isCloudAiProvider: (value: unknown) =>
    value === "anthropic" || value === "openai",
  removeWorkspaceAiConfig: mocks.removeConfig,
  saveWorkspaceAiConfig: mocks.saveConfig,
  validateWorkspaceAiConnection: mocks.validateConnection,
}));

import {
  getWorkspaceAiSettingsAction,
  saveWorkspaceAiSettingsAction,
} from "@/app/editor/ai-config-actions";

describe("workspace AI settings actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBlogEditAccess.mockResolvedValue({
      isOwner: true,
      blogId: "blog-1",
      ownerId: "user-1",
    });
    mocks.getStatus.mockResolvedValue({ configured: false, provider: null, model: null, connectionState: "not-set-up", checkedAt: null });
    mocks.validateConnection.mockResolvedValue(undefined);
  });

  it("stores the key server-side and returns only write-only status", async () => {
    const apiKey = "sk-test-value-that-must-not-leak";
    const result = await saveWorkspaceAiSettingsAction(
      "local",
      "anthropic",
      "claude-sonnet-5",
      apiKey,
    );

    expect(mocks.saveConfig).toHaveBeenCalledWith(
      "blog-1",
      "anthropic",
      "claude-sonnet-5",
      apiKey,
    );
    expect(mocks.validateConnection).toHaveBeenCalledWith(
      "anthropic",
      "claude-sonnet-5",
      apiKey,
    );
    expect(result).toEqual({
      allowed: true,
      configured: true,
      provider: "anthropic",
      model: "claude-sonnet-5",
      connectionState: "ready",
      checkedAt: expect.any(String),
    });
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "configure_cloud_ai",
        inputSummary: "anthropic:claude-sonnet-5",
      }),
    );
    expect(JSON.stringify(mocks.recordAction.mock.calls)).not.toContain(apiKey);
  });

  it("hides the owner-only section from non-owners", async () => {
    mocks.getBlogEditAccess.mockResolvedValue({
      isOwner: false,
      blogId: "blog-1",
      ownerId: "user-1",
    });

    await expect(getWorkspaceAiSettingsAction("local")).resolves.toEqual({
      allowed: false,
      configured: false,
      provider: null,
      model: null,
      connectionState: "not-set-up",
      checkedAt: null,
    });
  });

  it("returns a safe rejected-generation result and never stores the rejected key", async () => {
    mocks.validateConnection.mockRejectedValue(new AiConnectionError(aiFailure("authentication", "27aa246c-5c98-4161-b50d-27a6fd66b072")));
    const result = await saveWorkspaceAiSettingsAction("local", "anthropic", "claude-sonnet-5", "sk-rejected-value-that-must-not-leak");
    expect(result).toMatchObject({ configured: false, failure: { code: "authentication" } });
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(mocks.recordAction).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("sk-rejected");
  });

  it("does not replace an explicitly invalid model with a default", async () => {
    const result = await saveWorkspaceAiSettingsAction("local", "openai", "missing-model", "sk-rejected-value-that-must-not-leak");
    expect(result.failure?.code).toBe("model-access");
    expect(mocks.validateConnection).not.toHaveBeenCalled();
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });
});
