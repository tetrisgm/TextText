import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBlogEditAccess: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/blog-edit-auth", () => ({
  getBlogEditAccess: mocks.getBlogEditAccess,
}));
vi.mock("@/lib/ai/workspace-agent-instructions.server", () => ({
  getWorkspaceAgentSettings: mocks.getSettings,
}));

import { getWorkspaceAgentSkillMetadataAction } from "@/app/editor/agent-skill-metadata-actions";

describe("workspace agent skill launcher metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBlogEditAccess.mockResolvedValue({
      isOwner: true,
      blogId: "blog-1",
      ownerId: "owner-1",
    });
    mocks.getSettings.mockResolvedValue({
      instructions: "Private standing instructions.",
      skills: [
        {
          name: "Weekly review",
          trigger: "weekly-review",
          instructions: "Private skill instructions.",
        },
      ],
    });
  });

  it("returns only bounded name and shortcut metadata to the owner", async () => {
    const result = await getWorkspaceAgentSkillMetadataAction(" My-Space ");

    expect(mocks.getBlogEditAccess).toHaveBeenCalledWith("my-space");
    expect(mocks.getSettings).toHaveBeenCalledWith("blog-1");
    expect(result).toEqual({
      allowed: true,
      skills: [{ name: "Weekly review", trigger: "weekly-review" }],
    });
    expect(JSON.stringify(result)).not.toContain("Private");
  });

  it("returns nothing to collaborators without loading owner settings", async () => {
    mocks.getBlogEditAccess.mockResolvedValue({
      isOwner: false,
      blogId: "blog-1",
      ownerId: "collaborator-1",
    });

    await expect(
      getWorkspaceAgentSkillMetadataAction("my-space"),
    ).resolves.toEqual({ allowed: false, skills: [] });
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it("fails closed when authorization or metadata loading fails", async () => {
    mocks.getBlogEditAccess.mockRejectedValue(new Error("Unavailable"));
    await expect(
      getWorkspaceAgentSkillMetadataAction("my-space"),
    ).resolves.toEqual({ allowed: false, skills: [] });

    mocks.getBlogEditAccess.mockResolvedValue({
      isOwner: true,
      blogId: "blog-1",
      ownerId: "owner-1",
    });
    mocks.getSettings.mockRejectedValue(new Error("Unavailable"));
    await expect(
      getWorkspaceAgentSkillMetadataAction("my-space"),
    ).resolves.toEqual({ allowed: false, skills: [] });
  });
});
