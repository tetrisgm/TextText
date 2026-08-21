// Client for the workspace-owned AI connection. The browser sees provider and
// model metadata, never the configured key.

export type CloudAssistantProviderLabel = "Anthropic" | "OpenAI";

export type CloudAssistantContext = {
  level?: string;
  folderPath?: string;
  postId?: string;
  /** The open item's title, so a request about "this" has a subject. */
  itemTitle?: string;
  /** Exactly what the writer selected, when they selected something. */
  selection?: string;
  /** The opening of the body, bounded. The model can read the rest. */
  itemPreview?: string;
  /** IDs for TextText items the server must resolve in this workspace. */
  relatedItems?: Array<{ id: string }>;
  /** Suggestion turns are server-limited to read-only workspace tools. */
  mode?: "suggestion";
};

export type CloudAssistantStatus = {
  enabled: boolean;
  provider: CloudAssistantProviderLabel | null;
  model: string | null;
};

/**
 * One thing the assistant did on a machine this workspace does not control.
 * Shown in the conversation, because a remote side effect the person cannot
 * see is one they cannot object to.
 */
export type OutboundCall = {
  connection: string;
  tool: string;
  status: "ok" | "input_required" | "failed";
};

/** One validated TextText workspace command completed during the model turn. */
export type CloudWorkspaceCall = {
  tool: string;
  args: Record<string, unknown>;
  output: unknown;
};

export type CloudContextItem = {
  id: string;
  title: string;
  folderPath: string;
  slug: string;
};

export type CloudAssistantOutcome =
  | {
      text: string;
      provider: CloudAssistantProviderLabel;
      outboundCalls: OutboundCall[];
      workspaceCalls: CloudWorkspaceCall[];
      /** Exact access-checked items supplied as source context for the turn. */
      contextItems: CloudContextItem[];
      /** Some commands completed before the provider failed later in the turn. */
      terminalError?: string;
      /** Connected servers that did not answer, so the turn was smaller. */
      unreachableServers: string[];
    }
  | { disabled: true };

function cleanOutboundCalls(value: unknown): OutboundCall[] {
  if (!Array.isArray(value)) return [];
  const calls: OutboundCall[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.connection !== "string" ||
      typeof candidate.tool !== "string"
    ) {
      continue;
    }
    const status =
      candidate.status === "input_required" || candidate.status === "failed"
        ? candidate.status
        : "ok";
    calls.push({
      connection: candidate.connection,
      tool: candidate.tool,
      status,
    });
  }
  return calls;
}

function cleanRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanWorkspaceCalls(value: unknown): CloudWorkspaceCall[] {
  if (!Array.isArray(value)) return [];
  const calls: CloudWorkspaceCall[] = [];
  for (const entry of value.slice(0, 16)) {
    const candidate = cleanRecord(entry);
    const args = cleanRecord(candidate?.args);
    if (!candidate || typeof candidate.tool !== "string" || !args) continue;
    calls.push({
      tool: candidate.tool,
      args,
      output: candidate.output,
    });
  }
  return calls;
}

function cleanContextItems(value: unknown): CloudContextItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((entry) => {
    const candidate = cleanRecord(entry);
    if (
      !candidate ||
      typeof candidate.id !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.folderPath !== "string" ||
      typeof candidate.slug !== "string"
    ) {
      return [];
    }
    return [{
      id: candidate.id,
      title: candidate.title,
      folderPath: candidate.folderPath,
      slug: candidate.slug,
    }];
  });
}

export async function cloudAssistantStatus(): Promise<CloudAssistantStatus> {
  const response = await fetch("/api/ai", {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) return { enabled: false, provider: null, model: null };
  const data = (await response.json()) as {
    enabled?: unknown;
    provider?: unknown;
    model?: unknown;
  };
  const provider =
    data.provider === "Anthropic" || data.provider === "OpenAI"
      ? data.provider
      : null;
  return {
    enabled: data.enabled === true && Boolean(provider),
    provider,
    model: typeof data.model === "string" ? data.model : null,
  };
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
  // 404 is the off-by-default gate: this owner has no configured provider.
  if (response.status === 404) return { disabled: true };
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (response.status === 502) {
      throw new Error(
        "Your request was not applied because the AI provider did not answer.",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Your request was not applied because this AI connection was rejected.",
      );
    }
    if (response.status === 429) {
      throw new Error("Nothing changed. Try again in a moment.");
    }
    throw new Error(data?.error || "The assistant could not finish that.");
  }
  const data = (await response.json()) as {
    text?: unknown;
    provider?: unknown;
    outboundCalls?: unknown;
    unreachableServers?: unknown;
    workspaceCalls?: unknown;
    contextItems?: unknown;
    terminalError?: unknown;
  };
  if (data.provider !== "Anthropic" && data.provider !== "OpenAI") {
    throw new Error("The cloud provider could not be identified.");
  }
  return {
    text: typeof data.text === "string" ? data.text : "",
    provider: data.provider,
    outboundCalls: cleanOutboundCalls(data.outboundCalls),
    workspaceCalls: cleanWorkspaceCalls(data.workspaceCalls),
    contextItems: cleanContextItems(data.contextItems),
    ...(typeof data.terminalError === "string" && data.terminalError.trim()
      ? { terminalError: data.terminalError.trim() }
      : {}),
    unreachableServers: Array.isArray(data.unreachableServers)
      ? data.unreachableServers.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  };
}
