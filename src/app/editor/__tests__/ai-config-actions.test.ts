import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBlogEditAccess: vi.fn(),
  getStatus: vi.fn(),
  recordAction: vi.fn(),
  removeConfig: vi.fn(),
  saveConfig: vi.fn(),
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
  });

  it("stores the key server-side and returns only write-only status", async () => {
    const apiKey = "sk-test-value-that-must-not-leak";
    const result = await saveWorkspaceAiSettingsAction(
      "local",
      "anthropic",
      apiKey,
    );

    expect(mocks.saveConfig).toHaveBeenCalledWith(
      "blog-1",
      "anthropic",
      apiKey,
    );
    expect(result).toEqual({
      allowed: true,
      configured: true,
      provider: "anthropic",
    });
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "configure_cloud_ai",
        inputSummary: "anthropic",
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
    });
  });
});
