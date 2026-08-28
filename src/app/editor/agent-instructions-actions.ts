"use server";

import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import {
  buildWorkspaceAgentPrompt,
  cleanWorkspaceAgentSettings,
  EMPTY_WORKSPACE_AGENT_SETTINGS,
  type WorkspaceAgentSettings,
} from "@/lib/ai/agent-instructions";
import {
  getWorkspaceAgentSettings,
  removeWorkspaceAgentSettings,
  saveWorkspaceAgentSettings,
} from "@/lib/ai/workspace-agent-instructions.server";

type WorkspaceAgentSettingsState = WorkspaceAgentSettings & {
  allowed: boolean;
};

function cleanHandle(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function ownerAccess(handleInput: unknown) {
  const access = await getBlogEditAccess(cleanHandle(handleInput));
  if (!access.isOwner || !access.blogId || !access.ownerId) {
    throw new Error("Only the workspace owner can manage agent instructions.");
  }
  return { ...access, blogId: access.blogId, ownerId: access.ownerId };
}

export async function getWorkspaceAgentSettingsAction(
  handleInput: unknown,
): Promise<WorkspaceAgentSettingsState> {
  try {
    const access = await ownerAccess(handleInput);
    return {
      allowed: true,
      ...(await getWorkspaceAgentSettings(access.blogId)),
    };
  } catch {
    return { allowed: false, ...EMPTY_WORKSPACE_AGENT_SETTINGS };
  }
}

/** Owner-checked bridge for the standalone native assistant turn builder. */
export async function getWorkspaceAgentPromptAction(
  handleInput: unknown,
  currentRequest: unknown,
): Promise<string> {
  try {
    const access = await ownerAccess(handleInput);
    const settings = await getWorkspaceAgentSettings(access.blogId);
    return buildWorkspaceAgentPrompt(settings, currentRequest);
  } catch {
    return "";
  }
}

export async function saveWorkspaceAgentSettingsAction(
  handleInput: unknown,
  input: unknown,
): Promise<WorkspaceAgentSettingsState> {
  const access = await ownerAccess(handleInput);
  const settings = cleanWorkspaceAgentSettings(input);
  const saved = await saveWorkspaceAgentSettings(
    access.blogId,
    settings,
    access.ownerId,
  );
  return { allowed: true, ...saved };
}

export async function removeWorkspaceAgentSettingsAction(
  handleInput: unknown,
): Promise<WorkspaceAgentSettingsState> {
  const access = await ownerAccess(handleInput);
  await removeWorkspaceAgentSettings(access.blogId, access.ownerId);
  return { allowed: true, ...EMPTY_WORKSPACE_AGENT_SETTINGS };
}
