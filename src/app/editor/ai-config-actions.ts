"use server";

import { recordAction } from "@/lib/audit";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import {
  defaultCloudAiModel,
  isCloudAiModel,
} from "@/lib/ai/provider-catalog";
import {
  getWorkspaceAiConfigStatus,
  isCloudAiProvider,
  removeWorkspaceAiConfig,
  saveWorkspaceAiConfig,
  validateWorkspaceAiConnection,
  type CloudAiProvider,
} from "@/lib/ai/workspace-ai-config.server";

export type WorkspaceAiSettingsState = {
  allowed: boolean;
  configured: boolean;
  provider: CloudAiProvider | null;
  model: string | null;
};

function cleanHandle(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function cleanApiKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (key.length < 20 || key.length > 512 || /\s/.test(key)) {
    throw new Error("Enter a valid provider API key.");
  }
  return key;
}

async function ownerAccess(handleInput: unknown) {
  const handle = cleanHandle(handleInput);
  const access = await getBlogEditAccess(handle);
  if (!access.isOwner || !access.blogId || !access.ownerId) {
    throw new Error("Only the workspace owner can manage cloud AI.");
  }
  return {
    ...access,
    blogId: access.blogId,
    ownerId: access.ownerId,
  };
}

export async function getWorkspaceAiSettingsAction(
  handleInput: unknown,
): Promise<WorkspaceAiSettingsState> {
  try {
    const access = await ownerAccess(handleInput);
    const status = await getWorkspaceAiConfigStatus(access.blogId);
    return { allowed: true, ...status };
  } catch {
    return { allowed: false, configured: false, provider: null, model: null };
  }
}

export async function saveWorkspaceAiSettingsAction(
  handleInput: unknown,
  providerInput: unknown,
  modelInput: unknown,
  apiKeyInput: unknown,
): Promise<WorkspaceAiSettingsState> {
  const access = await ownerAccess(handleInput);
  if (!isCloudAiProvider(providerInput)) {
    throw new Error("Choose Anthropic or OpenAI.");
  }
  const model = isCloudAiModel(providerInput, modelInput)
    ? modelInput
    : defaultCloudAiModel(providerInput);
  const apiKey = cleanApiKey(apiKeyInput);
  await validateWorkspaceAiConnection(providerInput, model, apiKey);
  await saveWorkspaceAiConfig(access.blogId, providerInput, model, apiKey);
  await recordAction({
    actorUserId: access.ownerId,
    actorType: "human",
    actionName: "configure_cloud_ai",
    targetType: "workspace",
    targetId: access.blogId,
    inputSummary: `${providerInput}:${model}`,
  });
  return {
    allowed: true,
    configured: true,
    provider: providerInput,
    model,
  };
}

export async function removeWorkspaceAiSettingsAction(
  handleInput: unknown,
): Promise<WorkspaceAiSettingsState> {
  const access = await ownerAccess(handleInput);
  const previous = await getWorkspaceAiConfigStatus(access.blogId);
  await removeWorkspaceAiConfig(access.blogId);
  await recordAction({
    actorUserId: access.ownerId,
    actorType: "human",
    actionName: "remove_cloud_ai",
    targetType: "workspace",
    targetId: access.blogId,
    inputSummary: previous.provider ?? undefined,
  });
  return { allowed: true, configured: false, provider: null, model: null };
}
