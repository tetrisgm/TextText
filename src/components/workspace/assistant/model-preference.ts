import {
  AUTO_CLOUD_AI_MODEL,
  CLOUD_AI_CATALOG,
  isCloudAiModel,
  type CloudAiProvider,
} from "@/lib/ai/provider-catalog";
import type { CloudAssistantProviderLabel } from "@/lib/ai/cloud-client";

export type AssistantModelChoice = {
  id: string;
  label: string;
};

type StoredAssistantModel = {
  provider: CloudAiProvider;
  model: string;
};

function providerKey(
  provider: CloudAssistantProviderLabel | null,
): CloudAiProvider | null {
  if (provider === "Anthropic") return "anthropic";
  if (provider === "OpenAI") return "openai";
  return null;
}

function storageKey(handle: string): string {
  return `texttext:assistant-model:v1:${handle}`;
}

function persist(
  handle: string,
  provider: CloudAiProvider,
  model: string,
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(handle),
      JSON.stringify({ provider, model } satisfies StoredAssistantModel),
    );
  } catch {
    // Automatic selection remains a safe fallback.
  }
}

export function assistantModelChoices(
  providerLabel: CloudAssistantProviderLabel | null,
): AssistantModelChoice[] {
  const provider = providerKey(providerLabel);
  return provider
    ? [
        { id: AUTO_CLOUD_AI_MODEL, label: "Auto" },
        ...CLOUD_AI_CATALOG[provider].models.map((model) => ({ ...model })),
      ]
    : [];
}

/**
 * Restores only a model allowlisted for the currently connected provider.
 * Switching providers replaces the old preference with automatic selection.
 */
export function readAssistantModelPreference(
  handle: string,
  providerLabel: CloudAssistantProviderLabel | null,
): string | null {
  const provider = providerKey(providerLabel);
  if (!provider) return null;
  const fallback = AUTO_CLOUD_AI_MODEL;
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey(handle));
    if (raw) {
      const stored = JSON.parse(raw) as Partial<StoredAssistantModel>;
      if (
        stored.provider === provider &&
        (stored.model === AUTO_CLOUD_AI_MODEL ||
          isCloudAiModel(provider, stored.model))
      ) {
        return stored.model;
      }
    }
  } catch {
    // A malformed preference is replaced by automatic selection below.
  }
  persist(handle, provider, fallback);
  return fallback;
}

export function saveAssistantModelPreference(
  handle: string,
  providerLabel: CloudAssistantProviderLabel | null,
  model: unknown,
): string | null {
  const provider = providerKey(providerLabel);
  if (
    !provider ||
    (model !== AUTO_CLOUD_AI_MODEL && !isCloudAiModel(provider, model))
  ) {
    return null;
  }
  persist(handle, provider, model);
  return model;
}
