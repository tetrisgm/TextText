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
