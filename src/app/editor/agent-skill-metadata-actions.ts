"use server";

import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { getWorkspaceAgentSettings } from "@/lib/ai/workspace-agent-instructions.server";
import {
  boundedAssistantSkillMetadata,
  type AssistantSkillMetadata,
} from "@/components/workspace/assistant/skill-launcher";

type WorkspaceAgentSkillMetadataState = {
  allowed: boolean;
  skills: AssistantSkillMetadata[];
};

function cleanHandle(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Owner-only launcher metadata. This action never returns standing guidance or
 * skill instructions, and it does not inspect workspace documents.
 */
export async function getWorkspaceAgentSkillMetadataAction(
  handleInput: unknown,
): Promise<WorkspaceAgentSkillMetadataState> {
  try {
    const access = await getBlogEditAccess(cleanHandle(handleInput));
    if (!access.isOwner || !access.blogId || !access.ownerId) {
      return { allowed: false, skills: [] };
    }
    const settings = await getWorkspaceAgentSettings(access.blogId);
    return {
      allowed: true,
      skills: boundedAssistantSkillMetadata(settings.skills),
    };
  } catch {
    return { allowed: false, skills: [] };
  }
}
