import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { WorkspaceAiConfig } from "@/lib/ai/workspace-ai-config.server";

/**
 * Build the language model used by every first-party AI surface.
 *
 * Keeping this in one server-only module matters for more than tidiness: the
 * assistant and the item-type studio must honor the exact same Keychain-backed
 * development override and the exact same workspace-owned provider key.
 */
export function workspaceLanguageModel(
  config: WorkspaceAiConfig,
): LanguageModel {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const baseURL = isDevelopment
    ? process.env.TEXTTEXT_AI_BASE_URL || undefined
    : undefined;
  const apiKey =
    isDevelopment && process.env.TEXTTEXT_DEV_AI_KEY
      ? process.env.TEXTTEXT_DEV_AI_KEY
      : config.apiKey;

  return config.provider === "anthropic"
    ? createAnthropic({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      })(config.model)
    : createOpenAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      })(config.model);
}
