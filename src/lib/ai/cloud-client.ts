// Client for the opt-in cloud assistant fallback. The status probe exposes only
// enabled/provider metadata, never the configured key. Content is posted only
// after the native capability probe has failed and the server confirms a cloud
// provider is configured for this owner.

export type CloudAssistantProviderLabel = "Anthropic" | "OpenAI";

export type CloudAssistantContext = {
  level?: string;
  folderPath?: string;
  postId?: string;
};

export type CloudAssistantStatus = {
  enabled: boolean;
  provider: CloudAssistantProviderLabel | null;
};

export type CloudAssistantOutcome =
  | { text: string; provider: CloudAssistantProviderLabel }
  | { disabled: true };

export async function cloudAssistantStatus(): Promise<CloudAssistantStatus> {
  const response = await fetch("/api/ai", {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) return { enabled: false, provider: null };
  const data = (await response.json()) as {
    enabled?: unknown;
    provider?: unknown;
  };
  const provider =
    data.provider === "Anthropic" || data.provider === "OpenAI"
      ? data.provider
      : null;
  return { enabled: data.enabled === true && Boolean(provider), provider };
}

export async function cloudAssistantTurn(
  prompt: string,
  context?: CloudAssistantContext,
): Promise<CloudAssistantOutcome> {
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      context,
    }),
  });
  // 404 is the off-by-default gate: this owner has no configured cloud rung.
  if (response.status === 404) return { disabled: true };
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(data?.error || "The assistant could not finish that.");
  }
  const data = (await response.json()) as {
    text?: unknown;
    provider?: unknown;
  };
  if (data.provider !== "Anthropic" && data.provider !== "OpenAI") {
    throw new Error("The cloud provider could not be identified.");
  }
  return {
    text: typeof data.text === "string" ? data.text : "",
    provider: data.provider,
  };
}
