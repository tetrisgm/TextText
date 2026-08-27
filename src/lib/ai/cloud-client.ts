// Client for the workspace-owned AI connection. The browser sees provider and
// model metadata, never the configured key.

import { TENANT_HANDLE_RE } from "@/lib/tenants";

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
  /** Bounded image parts uploaded over HTTPS for the hosted model. */
  attachments?: CloudAssistantAttachment[];
  /** Suggestion turns are server-limited to read-only workspace tools. */
  mode?: "suggestion";
};

export type CloudAssistantAttachment = {
  name: string;
  mediaType: string;
  dataUrl: string;
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

/**
 * One TextText workspace command attempted during the model turn, and whether
 * it worked. A failed command carries the executor's own message so the UI
 * never has to quote the model's retelling of it.
 */
export type CloudWorkspaceCall = {
  tool: string;
  args: Record<string, unknown>;
  output: unknown;
  status?: "ok" | "failed";
  error?: string;
};

type CloudAssistantWriteProposalBase = {
  id: string;
  status: "pending";
  tool: string;
  title: string;
  summary: string;
  arguments: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
};

export type CloudAssistantWriteProposal =
  | (CloudAssistantWriteProposalBase & { kind: "workspace" })
  | (CloudAssistantWriteProposalBase & {
      kind: "outbound_mcp";
      connection: { id: string; name: string };
      remoteTool: {
        name: string;
        description: string;
        annotations: {
          title?: string;
          readOnlyHint?: boolean;
          destructiveHint?: boolean;
          idempotentHint?: boolean;
          openWorldHint?: boolean;
        };
      };
    });

export type CloudContextItem = {
  id: string;
  title: string;
  folderPath: string;
  slug: string;
  operation: "Found" | "Read";
};

export type CloudAssistantOutcome =
  | {
      text: string;
      provider: CloudAssistantProviderLabel;
      model: string;
      outboundCalls: OutboundCall[];
      workspaceCalls: CloudWorkspaceCall[];
      writeProposals: CloudAssistantWriteProposal[];
      /** Exact access-checked items supplied as source context for the turn. */
      contextItems: CloudContextItem[];
      /** Some commands completed before the provider failed later in the turn. */
      terminalError?: string;
      /** Connected servers that did not answer, so the turn was smaller. */
      unreachableServers: string[];
    }
  | { disabled: true };

export type CloudAssistantStreamEvent =
  | { type: "start"; provider: CloudAssistantProviderLabel; model: string }
  | { type: "text"; text: string }
  | { type: "progress"; message: string; tool?: string }
  | {
      type: "complete";
      text: string;
      provider: CloudAssistantProviderLabel;
      model: string;
      outboundCalls: OutboundCall[];
      unreachableServers: string[];
      workspaceCalls: CloudWorkspaceCall[];
      writeProposals: CloudAssistantWriteProposal[];
      contextItems: CloudContextItem[];
    }
  | {
      type: "error";
      message: string;
      partialText?: string;
      outboundCalls?: OutboundCall[];
      unreachableServers?: string[];
      workspaceCalls?: CloudWorkspaceCall[];
      writeProposals?: CloudAssistantWriteProposal[];
    };

export type CloudAssistantTurnOptions = {
  /** Optional per-turn model from the connected provider's allowlisted catalog. */
  model?: string;
  /** Bounded prior user/assistant turns from this exact TextText chat. */
  history?: ReadonlyArray<{
    role: "user" | "assistant";
    content: string;
  }>;
  /** Use the incremental NDJSON protocol instead of the legacy JSON response. */
  stream?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: CloudAssistantStreamEvent) => void;
};

export async function submitAssistantFeedback(input: {
  messageId: string;
  rating: "up" | "down";
  provider?: CloudAssistantProviderLabel | "Codex";
}): Promise<void> {
  const response = await fetch("/api/ai/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("The answer rating could not be saved.");
}

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
    const failed = candidate.status === "failed";
    calls.push({
      tool: candidate.tool,
      args,
      output: candidate.output,
      status: failed ? "failed" : "ok",
      // Bounded, because it is rendered, and it is the executor's own words.
      ...(failed && typeof candidate.error === "string" && candidate.error.trim()
        ? { error: candidate.error.trim().slice(0, 400) }
        : {}),
    });
  }
  return calls;
}

function cleanWriteProposals(value: unknown): CloudAssistantWriteProposal[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((entry): CloudAssistantWriteProposal[] => {
    const candidate = cleanRecord(entry);
    const args = cleanRecord(candidate?.arguments);
    if (
      !candidate ||
      !args ||
      typeof candidate.id !== "string" ||
      candidate.status !== "pending" ||
      typeof candidate.tool !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.summary !== "string" ||
      typeof candidate.createdAt !== "string" ||
      typeof candidate.expiresAt !== "string"
    ) {
      return [];
    }
    const common = {
      id: candidate.id,
      status: "pending" as const,
      tool: candidate.tool,
      title: candidate.title,
      summary: candidate.summary,
      arguments: args,
      createdAt: candidate.createdAt,
      expiresAt: candidate.expiresAt,
    };
    if (candidate.kind !== "outbound_mcp") {
      return [{ ...common, kind: "workspace" as const }];
    }
    const connection = cleanRecord(candidate.connection);
    const remoteTool = cleanRecord(candidate.remoteTool);
    const annotations = cleanRecord(remoteTool?.annotations) ?? {};
    if (
      !connection ||
      !remoteTool ||
      typeof connection.id !== "string" ||
      typeof connection.name !== "string" ||
      typeof remoteTool.name !== "string" ||
      typeof remoteTool.description !== "string"
    ) {
      return [];
    }
    const cleanAnnotations: NonNullable<
      Extract<CloudAssistantWriteProposal, { kind: "outbound_mcp" }>["remoteTool"]
    >["annotations"] = {};
    if (typeof annotations.title === "string") {
      cleanAnnotations.title = annotations.title.slice(0, 200);
    }
    for (const key of [
      "readOnlyHint",
      "destructiveHint",
      "idempotentHint",
      "openWorldHint",
    ] as const) {
      if (typeof annotations[key] === "boolean") {
        cleanAnnotations[key] = annotations[key];
      }
    }
    return [{
      ...common,
      kind: "outbound_mcp" as const,
      connection: {
        id: connection.id.slice(0, 128),
        name: connection.name.slice(0, 120),
      },
      remoteTool: {
        name: remoteTool.name.slice(0, 64),
        description: remoteTool.description.slice(0, 600),
        annotations: cleanAnnotations,
      },
    }];
  });
}

export async function decideCloudAssistantWriteProposal(
  id: string,
  decision: "approve" | "deny",
): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/ai/proposals/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : "The proposed change could not be decided.",
    );
  }
  return data ?? {};
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
      // Missing or malformed provenance fails closed to discovery. Only the
      // server's explicit Read marker may become a full-source receipt.
      operation: candidate.operation === "Read" ? "Read" : "Found",
    }];
  });
}

function cleanWorkspaceHandle(value: string): string | null {
  const handle = value.trim().toLowerCase();
  return TENANT_HANDLE_RE.test(handle) ? handle : null;
}

export async function cloudAssistantStatus(
  workspaceHandle: string,
): Promise<CloudAssistantStatus> {
  const handle = cleanWorkspaceHandle(workspaceHandle);
  if (!handle) return { enabled: false, provider: null, model: null };
  const response = await fetch(
    `/api/ai?workspaceHandle=${encodeURIComponent(handle)}`,
    {
      method: "GET",
      cache: "no-store",
    },
  );
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
  workspaceHandle: string,
  prompt: string,
  context?: CloudAssistantContext,
  options: CloudAssistantTurnOptions = {},
): Promise<CloudAssistantOutcome> {
  const handle = cleanWorkspaceHandle(workspaceHandle);
  if (!handle) {
    throw new Error(
      "Your request was not applied because the workspace could not be verified.",
    );
  }
  const stream = options.stream === true;
  const history = (options.history ?? [])
    .slice(-20)
    .reduceRight<Array<{ role: "user" | "assistant"; content: string }>>(
      (bounded, message) => {
        if (
          (message.role !== "user" && message.role !== "assistant") ||
          typeof message.content !== "string"
        ) {
          return bounded;
        }
        const content = message.content.trim().slice(0, 8_000);
        if (!content) return bounded;
        const used = bounded.reduce(
          (total, entry) => total + entry.content.length,
          0,
        );
        return used + content.length <= 32_000
          ? [{ role: message.role, content }, ...bounded]
          : bounded;
      },
      [],
    );
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(stream ? { Accept: "application/x-ndjson" } : {}),
    },
    body: JSON.stringify({
      workspaceHandle: handle,
      messages: [...history, { role: "user", content: prompt }],
      context,
      ...(options.model ? { model: options.model } : {}),
      ...(stream ? { stream: true } : {}),
    }),
    ...(options.signal ? { signal: options.signal } : {}),
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
  if (stream) {
    if (!response.body) {
      throw new Error("The assistant returned an empty stream.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let provider: CloudAssistantProviderLabel | null = null;
    let model = "";
    let partialText = "";
    let latest: CloudAssistantOutcome | null = null;
    let failed = false;
    const consumeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let raw: unknown;
      try {
        raw = JSON.parse(trimmed);
      } catch {
        return;
      }
      const record = cleanRecord(raw);
      if (!record || typeof record.type !== "string") return;
      if (record.type === "start") {
        const nextProvider =
          record.provider === "Anthropic" || record.provider === "OpenAI"
            ? record.provider
            : null;
        if (nextProvider) provider = nextProvider;
        model = typeof record.model === "string" ? record.model : model;
      }
      if (record.type === "text" && typeof record.text === "string") {
        partialText += record.text;
      }
      if (record.type === "complete" && !failed) {
        const nextProvider =
          record.provider === "Anthropic" || record.provider === "OpenAI"
            ? record.provider
            : provider;
        if (!nextProvider) return;
        provider = nextProvider;
        model = typeof record.model === "string" ? record.model : model;
        latest = {
          text: typeof record.text === "string" ? record.text : partialText,
          provider,
          model,
          outboundCalls: cleanOutboundCalls(record.outboundCalls),
          workspaceCalls: cleanWorkspaceCalls(record.workspaceCalls),
          writeProposals: cleanWriteProposals(record.writeProposals),
          contextItems: cleanContextItems(record.contextItems),
          unreachableServers: Array.isArray(record.unreachableServers)
            ? record.unreachableServers.filter(
                (entry): entry is string => typeof entry === "string",
              )
            : [],
        };
      }
      options.onEvent?.(cleanStreamEvent(record, provider, model));
      if (record.type === "error" && !latest && provider) {
        failed = true;
        latest = {
          text:
            typeof record.partialText === "string"
              ? record.partialText
              : partialText,
          provider,
          model,
          outboundCalls: cleanOutboundCalls(record.outboundCalls),
          workspaceCalls: cleanWorkspaceCalls(record.workspaceCalls),
          writeProposals: cleanWriteProposals(record.writeProposals),
          contextItems: [],
          unreachableServers: Array.isArray(record.unreachableServers)
            ? record.unreachableServers.filter(
                (entry): entry is string => typeof entry === "string",
              )
            : [],
          terminalError:
            typeof record.message === "string"
              ? record.message
              : "The assistant could not finish that.",
        };
      }
    };
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value ?? new Uint8Array(), {
        stream: !chunk.done,
      });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
      if (chunk.done) break;
    }
    if (buffer.trim()) consumeLine(buffer);
    if (latest) return latest;
    if (provider) {
      return {
        text: partialText,
        provider,
        model,
        outboundCalls: [],
        workspaceCalls: [],
        writeProposals: [],
        contextItems: [],
        unreachableServers: [],
        terminalError: "The assistant stopped before it could finish.",
      };
    }
    throw new Error("The assistant returned no usable response.");
  }

  const data = (await response.json()) as {
    text?: unknown;
    provider?: unknown;
    model?: unknown;
    outboundCalls?: unknown;
    unreachableServers?: unknown;
    workspaceCalls?: unknown;
    writeProposals?: unknown;
    contextItems?: unknown;
    terminalError?: unknown;
  };
  if (data.provider !== "Anthropic" && data.provider !== "OpenAI") {
    throw new Error("The cloud provider could not be identified.");
  }
  return {
    text: typeof data.text === "string" ? data.text : "",
    provider: data.provider,
    model: typeof data.model === "string" ? data.model : "",
    outboundCalls: cleanOutboundCalls(data.outboundCalls),
    workspaceCalls: cleanWorkspaceCalls(data.workspaceCalls),
    writeProposals: cleanWriteProposals(data.writeProposals),
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

function cleanStreamEvent(
  record: Record<string, unknown>,
  provider: CloudAssistantProviderLabel | null,
  model: string,
): CloudAssistantStreamEvent {
  if (record.type === "start") {
    return {
      type: "start",
      provider: provider ?? "OpenAI",
      model,
    };
  }
  if (record.type === "text") {
    return {
      type: "text",
      text: typeof record.text === "string" ? record.text : "",
    };
  }
  if (record.type === "progress") {
    return {
      type: "progress",
      message:
        typeof record.message === "string" ? record.message : "Working",
      ...(typeof record.tool === "string" ? { tool: record.tool } : {}),
    };
  }
  if (record.type === "complete") {
    return {
      type: "complete",
      text: typeof record.text === "string" ? record.text : "",
      provider: provider ?? "OpenAI",
      model,
      outboundCalls: cleanOutboundCalls(record.outboundCalls),
      unreachableServers: Array.isArray(record.unreachableServers)
        ? record.unreachableServers.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [],
      workspaceCalls: cleanWorkspaceCalls(record.workspaceCalls),
      writeProposals: cleanWriteProposals(record.writeProposals),
      contextItems: cleanContextItems(record.contextItems),
    };
  }
  return {
    type: "error",
    message:
      typeof record.message === "string"
        ? record.message
        : "The assistant could not finish that.",
    ...(typeof record.partialText === "string"
      ? { partialText: record.partialText }
      : {}),
    outboundCalls: cleanOutboundCalls(record.outboundCalls),
    unreachableServers: Array.isArray(record.unreachableServers)
      ? record.unreachableServers.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    workspaceCalls: cleanWorkspaceCalls(record.workspaceCalls),
    writeProposals: cleanWriteProposals(record.writeProposals),
  };
}
