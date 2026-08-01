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
import { getOwnedBlog, getUserIdBySub } from "@/lib/store";
import { cloudAssistantTools } from "@/lib/ai/cloud-tools";
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

const SYSTEM =
  "You are the assistant inside TextText, an app for blogs, notes, and bookmarks. " +
  "The Blog folder holds public blog posts; Notes are private working notes; " +
  "Bookmarks are saved links. Notes and bookmarks are always unlisted. Use the " +
  "workspace tools to read and edit the user's items, and refer to items by their " +
  "id, which stays stable across renames and moves. Be concise and concrete. You " +
  "are running on the web, where destructive actions (trash, delete, sharing, " +
  "publishing) are not available to you; if the user asks for one, say they can do " +
  "it from the app's own controls.";

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
  };
  const bits: string[] = [];
  if (typeof view.level === "string") bits.push(`level ${view.level}`);
  if (typeof view.folderPath === "string" && view.folderPath) {
    bits.push(`folder ${view.folderPath}`);
  }
  if (typeof view.postId === "string" && view.postId) {
    bits.push(`current item id ${view.postId}`);
  }
  return bits.length ? `${SYSTEM}\n\nCurrent view: ${bits.join(", ")}.` : SYSTEM;
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
  const model =
    config.provider === "anthropic"
      ? createAnthropic({ apiKey: config.apiKey })(config.model)
      : createOpenAI({ apiKey: config.apiKey })(config.model);

  try {
    const result = await generateText({
      model,
      system: buildSystem(body.context),
      messages,
      tools: cloudAssistantTools(actor),
      stopWhen: stepCountIs(MAX_STEPS),
    });
    return Response.json({ text: result.text, provider, model: config.model });
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
