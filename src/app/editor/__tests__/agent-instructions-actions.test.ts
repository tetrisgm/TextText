import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBlogEditAccess: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  removeSettings: vi.fn(),
}));

vi.mock("@/lib/blog-edit-auth", () => ({
  getBlogEditAccess: mocks.getBlogEditAccess,
}));
vi.mock("@/lib/ai/workspace-agent-instructions.server", () => ({
  getWorkspaceAgentSettings: mocks.getSettings,
  saveWorkspaceAgentSettings: mocks.saveSettings,
  removeWorkspaceAgentSettings: mocks.removeSettings,
}));

import {
  getWorkspaceAgentPromptAction,
  getWorkspaceAgentSettingsAction,
  removeWorkspaceAgentSettingsAction,
  saveWorkspaceAgentSettingsAction,
} from "@/app/editor/agent-instructions-actions";

describe("workspace agent instruction actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBlogEditAccess.mockResolvedValue({
      isOwner: true,
      blogId: "blog-1",
      ownerId: "user-1",
    });
    mocks.getSettings.mockResolvedValue({
      instructions: "Be concise.",
      skills: [],
    });
    mocks.saveSettings.mockImplementation(async (_blogId, value) => value);
  });

  it("returns settings only to the workspace owner", async () => {
    await expect(getWorkspaceAgentSettingsAction("Local")).resolves.toEqual({
      allowed: true,
      instructions: "Be concise.",
      skills: [],
    });
    expect(mocks.getSettings).toHaveBeenCalledWith("blog-1");

    mocks.getBlogEditAccess.mockResolvedValue({
      isOwner: false,
      blogId: "blog-1",
      ownerId: "user-2",
    });
    await expect(getWorkspaceAgentSettingsAction("local")).resolves.toEqual({
      allowed: false,
      instructions: "",
      skills: [],
    });
  });

  it("builds an owner-checked prompt suffix for native assistant turns", async () => {
    mocks.getSettings.mockResolvedValue({
      instructions: "Use sentence case.",
      skills: [
        {
          name: "Outline",
          trigger: "outline",
          instructions: "Return a nested outline.",
        },
      ],
    });
    const prompt = await getWorkspaceAgentPromptAction(
      "local",
      "Please /outline this",
    );
    expect(prompt).toContain("Use sentence case.");
    expect(prompt).toContain("Explicitly requested skill /outline");

    mocks.getBlogEditAccess.mockResolvedValue({ isOwner: false });
    await expect(
      getWorkspaceAgentPromptAction("local", "/outline"),
    ).resolves.toBe("");
  });

  it("validates before persistence and audits without copying instruction text", async () => {
    const input = {
      instructions: "Always call the product TextText.",
      skills: [
        {
          name: "Outline",
          trigger: "outline",
          instructions: "Return a nested outline.",
        },
      ],
    };
    await expect(
      saveWorkspaceAgentSettingsAction("local", input),
    ).resolves.toEqual({
      allowed: true,
      ...input,
    });
    expect(mocks.saveSettings).toHaveBeenCalledWith(
      "blog-1",
      input,
      "user-1",
    );
  });

  it("removes the durable settings and records the mutation", async () => {
    await expect(removeWorkspaceAgentSettingsAction("local")).resolves.toEqual({
      allowed: true,
      instructions: "",
      skills: [],
    });
    expect(mocks.removeSettings).toHaveBeenCalledWith("blog-1", "user-1");
  });
});
