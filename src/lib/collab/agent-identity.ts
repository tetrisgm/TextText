export type AgentProviderId =
  | "chatgpt"
  | "claude"
  | "codex"
  | "cursor"
  | "agent";

type AgentIdentity = {
  provider: AgentProviderId;
  displayName: string;
};

const PROVIDER_COLORS: Partial<Record<AgentProviderId, string>> = {
  chatgpt: "#10a37f",
  claude: "#d97757",
  codex: "#111827",
  cursor: "#111111",
};

export function agentProviderColor(provider: AgentProviderId): string | null {
  return PROVIDER_COLORS[provider] ?? null;
}

export function agentIdentity(connectionName: string): AgentIdentity {
  const name = connectionName.trim();
  const normalized = name.toLocaleLowerCase();

  if (normalized.includes("claude") || normalized.includes("anthropic")) {
    return { provider: "claude", displayName: "Claude" };
  }
  if (normalized.includes("codex")) {
    return { provider: "codex", displayName: "Codex" };
  }
  if (normalized.includes("chatgpt") || normalized.includes("openai")) {
    return { provider: "chatgpt", displayName: "ChatGPT" };
  }
  if (normalized.includes("cursor")) {
    return { provider: "cursor", displayName: "Cursor" };
  }

  return {
    provider: "agent",
    displayName: name || "AI agent",
  };
}
