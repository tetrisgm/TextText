// Workspace-owned cloud assistant. TextText never spends a shared provider key:
// the owner explicitly connects a provider and chooses a model.
//
// MVP: non-streaming (returns the final reply). The cloud tool set excludes
// confirmation-gated destructive/sharing/publish tools until an interactive
// confirmation flow is wired for the web path (see cloud-tools.ts).

import { generateText, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { getCurrentUser } from "@/lib/session";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { getBlogEditRecord, getOwnedBlog, getUserIdBySub } from "@/lib/store";
import { cloudAssistantTools } from "@/lib/ai/cloud-tools";
import {
  outboundAssistantTools,
  outboundSystemNote,
  type OutboundCallRecord,
} from "@/lib/ai/outbound-tools";
import { enabledMcpConnections } from "@/lib/mcp/outbound.server";
import {
  listRemoteTools,
  type OutboundConnection,
  type RemoteTool,
} from "@/lib/mcp/outbound-client";
import {
  cloudProviderLabel,
  getWorkspaceAiConfigForOwner,
  getWorkspaceAiConfigStatusForOwner,
} from "@/lib/ai/workspace-ai-config.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_STEPS = 8;
const MAX_HISTORY = 20;
// Bound one request's input tokens: a single oversized message cannot balloon
// the model bill. Generous for a real prompt, small enough to defeat abuse.
const MAX_MESSAGE_CHARS = 16_000;
// Best-effort per-user throttle. Provider-side limits remain authoritative.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 20;
const recentHits = new Map<string, number[]>();

function rateLimited(sub: string): boolean {
  const now = Date.now();
  const recent = (recentHits.get(sub) ?? []).filter(
    (at) => now - at < RATE_WINDOW_MS,
  );
  recent.push(now);
  recentHits.set(sub, recent);
  if (recentHits.size > 5_000) {
    for (const [key, times] of recentHits) {
      if (times.every((at) => now - at >= RATE_WINDOW_MS)) {
        recentHits.delete(key);
      }
    }
  }
  return recent.length > RATE_MAX_PER_WINDOW;
}

const SYSTEM = ASSISTANT_SYSTEM_PROMPT;

/**
 * Remembered tool lists, keyed by connection, expiring when the server said
 * they would. In-process and best effort: losing it costs one round trip.
 */
const toolCache = new Map<string, { tools: RemoteTool[]; expiresAt: number }>();
const DEFAULT_TOOL_TTL_MS = 5 * 60 * 1000;

async function discoverTools(
  connection: OutboundConnection,
): Promise<RemoteTool[]> {
  const cached = toolCache.get(connection.id);
  if (cached && cached.expiresAt > Date.now()) return cached.tools;
  const { tools, ttlMs } = await listRemoteTools(connection);
  toolCache.set(connection.id, {
    tools,
    expiresAt: Date.now() + (ttlMs ?? DEFAULT_TOOL_TTL_MS),
  });
  if (toolCache.size > 500) {
    for (const [key, entry] of toolCache) {
      if (entry.expiresAt <= Date.now()) toolCache.delete(key);
    }
  }
  return tools;
}

function coerceMessages(value: unknown): ModelMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: ModelMessage[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if (
      (role === "user" || role === "assistant") &&
      typeof content === "string" &&
      content.trim()
    ) {
      messages.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) });
    }
  }
  return messages.slice(-MAX_HISTORY);
}

function buildSystem(context: unknown): string {
  if (!context || typeof context !== "object") return SYSTEM;
  const view = context as {
    level?: unknown;
    folderPath?: unknown;
    postId?: unknown;
    itemTitle?: unknown;
    selection?: unknown;
    itemPreview?: unknown;
  };
  const bits: string[] = [];
  if (typeof view.level === "string") bits.push(`level ${view.level}`);
  if (typeof view.folderPath === "string" && view.folderPath) {
    bits.push(`folder ${view.folderPath}`);
  }
  if (typeof view.postId === "string" && view.postId) {
    bits.push(`current item id ${view.postId}`);
  }
  if (typeof view.itemTitle === "string" && view.itemTitle.trim()) {
    bits.push(
      `current item title ${JSON.stringify(view.itemTitle.slice(0, 200))}`,
    );
  }
  const head = bits.length
    ? `${SYSTEM}\n\nCurrent view: ${bits.join(", ")}.`
    : SYSTEM;
  // The text itself goes after the view line, bounded, so a request about
  // "this document" is answerable without a round trip and a long document
  // never dominates the prompt.
  const parts = [head];
  if (typeof view.selection === "string" && view.selection.trim()) {
    parts.push(
      `The writer has this selected:\n"""\n${view.selection.slice(0, 4000)}\n"""`,
    );
  }
  if (typeof view.itemPreview === "string" && view.itemPreview.trim()) {
    parts.push(
      `The current item begins:\n"""\n${view.itemPreview.slice(0, 4000)}\n"""\nUse read_item for the rest.`,
    );
  }
  return parts.join(`\n\n`);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ enabled: false, provider: null });
  const workspace = await getOwnedBlog(user.sub);
  if (!workspace) return Response.json({ enabled: false, provider: null });
  const status = await getWorkspaceAiConfigStatusForOwner(user.sub);
  const enabled = status.configured;
  return Response.json({
    enabled,
    provider:
      enabled && status.provider ? cloudProviderLabel(status.provider) : null,
    model: enabled ? status.model : null,
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { error: "Sign in to use the assistant." },
      { status: 401 },
    );
  }
  // Owner-only: the assistant acts on the caller's OWNED workspace. Refuse (and
  // never spend a model call) for a signed-in user who owns no workspace, and
  // throttle per user so one owner cannot drain the shared gateway budget.
  const workspace = await getOwnedBlog(user.sub);
  if (!workspace) {
    return Response.json(
      { error: "You do not have a workspace to assist with." },
      { status: 403 },
    );
  }
  const config = await getWorkspaceAiConfigForOwner(user.sub);
  if (!config) {
    return Response.json(
      { error: "Connect an AI provider in Workspace Settings." },
      { status: 404 },
    );
  }
  if (rateLimited(user.sub)) {
    return Response.json(
      { error: "Too many assistant requests. Try again in a moment." },
      { status: 429 },
    );
  }

  let body: { messages?: unknown; context?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body" }, { status: 400 });
  }
  const messages = coerceMessages(body.messages);
  if (messages.length === 0) {
    return Response.json({ error: "messages is required" }, { status: 400 });
  }

  const userId = user.userId ?? (await getUserIdBySub(user.sub));
  const actor = {
    sub: user.sub,
    userId: userId ?? null,
    handle: workspace.handle,
  };
  const provider = cloudProviderLabel(config.provider);

  // Outbound MCP: a workspace can connect servers somebody else runs, and the
  // assistant may use their tools.
  //
  // Discovery is cached per connection for as long as the server says its list
  // is good for (2026-07-28 added ttlMs). Before that this route asked every
  // connected server for its tool list on every single message, which is a
  // round trip the person waits through to learn something that had not
  // changed.
  const workspaceRecord = await getBlogEditRecord(workspace.handle);
  const connections = workspaceRecord
    ? await enabledMcpConnections(workspaceRecord.id)
    : [];
  const reachable: Array<{
    connection: (typeof connections)[number];
    tools: RemoteTool[];
  }> = [];
  // A connected server that is down used to vanish silently, so the assistant
  // simply seemed unable to do what it did yesterday. Now the turn says so.
  const unreachable: string[] = [];
  await Promise.all(
    connections.map(async (connection) => {
      try {
        const tools = await discoverTools(connection);
        if (tools.length > 0) reachable.push({ connection, tools });
      } catch {
        unreachable.push(connection.name);
      }
    }),
  );
  // Development can override two things so the assistant lane is testable
  // without a real key ever passing through a person or an agent:
  //   TEXTTEXT_AI_BASE_URL points the provider at a local mock
  //     (scripts/mock-ai-provider.mjs) - a deterministic, no-key run.
  //   TEXTTEXT_DEV_AI_KEY supplies a real key read from the login Keychain
  //     by scripts/dev-secrets.sh, so a real provider can be exercised
  //     without the key touching the workspace form, the shell history, or
  //     any log.
  // Production ignores both entirely and uses the workspace-configured key.
  const isDev = process.env.NODE_ENV !== "production";
  const devBaseUrl = isDev ? process.env.TEXTTEXT_AI_BASE_URL || undefined : undefined;
  const apiKey =
    isDev && process.env.TEXTTEXT_DEV_AI_KEY
      ? process.env.TEXTTEXT_DEV_AI_KEY
      : config.apiKey;
  const model =
    config.provider === "anthropic"
      ? createAnthropic({
          apiKey,
          ...(devBaseUrl ? { baseURL: devBaseUrl } : {}),
        })(config.model)
      : createOpenAI({
          apiKey,
          ...(devBaseUrl ? { baseURL: devBaseUrl } : {}),
        })(config.model);

  const calls: OutboundCallRecord[] = [];
  const remoteTools = outboundAssistantTools(
    { userId: userId ?? null, handle: workspace.handle },
    reachable,
    (record) => calls.push(record),
  );

  try {
    const result = await generateText({
      model,
      system:
        buildSystem(body.context) +
        outboundSystemNote(
          reachable.map((entry) => entry.connection.name),
          unreachable,
        ),
      messages,
      tools: { ...cloudAssistantTools(actor), ...remoteTools },
      stopWhen: stepCountIs(MAX_STEPS),
    });
    return Response.json({
      text: result.text,
      provider,
      model: config.model,
      // What the assistant did on machines this workspace does not control.
      // The conversation shows these, because a remote side effect the person
      // cannot see is one they cannot object to.
      outboundCalls: calls,
      unreachableServers: unreachable,
    });
  } catch {
    // Provider errors can carry request metadata. Do not log the error object,
    // because a user-supplied API key must never reach logs.
    console.error("cloud assistant turn failed");
    return Response.json(
      { error: "The assistant could not complete that." },
      { status: 502 },
    );
  }
}
