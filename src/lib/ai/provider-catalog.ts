export const CLOUD_AI_CATALOG = {
  anthropic: {
    label: "Anthropic",
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
  },
  openai: {
    label: "OpenAI",
    models: [
      { id: "gpt-5.6", label: "GPT-5.6" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    ],
  },
} as const;

export type CloudAiProvider = keyof typeof CLOUD_AI_CATALOG;

export const AUTO_CLOUD_AI_MODEL = "auto";

export function defaultCloudAiModel(provider: CloudAiProvider): string {
  return CLOUD_AI_CATALOG[provider].models[0].id;
}

export function isCloudAiProvider(value: unknown): value is CloudAiProvider {
  return value === "anthropic" || value === "openai";
}

export function isCloudAiModel(
  provider: CloudAiProvider,
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    CLOUD_AI_CATALOG[provider].models.some((model) => model.id === value)
  );
}

/**
 * Choose the provider's fast model for a short answer and its strongest model
 * when the turn needs tools, files, broad synthesis, or careful reasoning.
 * This stays deterministic so a person can always see the actual model on the
 * completed answer and reproduce a turn by choosing it explicitly next time.
 */
export function automaticCloudAiModel(
  provider: CloudAiProvider,
  input: {
    request: string;
    hasAttachments?: boolean;
    hasWorkspaceContext?: boolean;
  },
): string {
  const request = input.request.trim();
  const needsStrongModel =
    Boolean(input.hasAttachments || input.hasWorkspaceContext) ||
    request.length > 420 ||
    /\b(analy[sz]e|clarify|compare|continue|count|create|critique|describe|document|edit|evidence|explain|export|feedback|find|improve|investigate|list|note|outline|plan|proofread|research|review|rewrite|search|send|shorten|source|strategy|summari[sz]e|synthesi[sz]e|translate|update|use|workspace|write)\b/i.test(
      request,
    );
  const models = CLOUD_AI_CATALOG[provider].models;
  return needsStrongModel ? models[0].id : models[models.length - 1].id;
}
