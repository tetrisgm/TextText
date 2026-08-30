// Workspace-owned cloud assistant. TextText never spends a shared provider key:
// the owner explicitly connects a provider and chooses a model.
//
// The HTTPS path streams newline-delimited progress and text events. The cloud
// tool set still excludes confirmation-gated destructive/sharing/publish tools
// until an interactive confirmation flow is wired for the web path.

import { generateText, stepCountIs, streamText } from "ai";
import type { ModelMessage, UserContent } from "ai";
import { getCurrentUser } from "@/lib/session";
import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import {
  getAccessibleRecentPosts,
  getBlogEditRecord,
  getOwnedBlog,
  getPostById,
  getUserIdBySub,
} from "@/lib/store";
import { isUuid, type AccessUser } from "@/lib/permissions";
import {
  guardedCloudAssistantTools,
  type CloudAssistantToolMode,
  type CloudAssistantWorkspaceCall,
  type CloudAssistantWriteProposal,
} from "@/lib/ai/cloud-tools";
import {
  explicitlyRequestedOutboundConnections,
  guardedOutboundAssistantTools,
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
import { workspaceLanguageModel } from "@/lib/ai/provider-model.server";
import {
  AUTO_CLOUD_AI_MODEL,
  automaticCloudAiModel,
  isCloudAiModel,
} from "@/lib/ai/provider-catalog";
import { workspaceAgentPromptForOwner } from "@/lib/ai/workspace-agent-instructions.server";
import { readBoundedJson } from "@/lib/http/bounded-json";
import { TENANT_HANDLE_RE } from "@/lib/tenants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * How many turns of think-then-act one request may take.
 *
 * It was 8, and the route already has two harder bounds: `maxDuration = 60`
 * kills the request on wall clock whatever the step count, and each owner is
 * throttled. So this was a third, tighter limit that mostly truncated useful
 * work: putting a different closing line in three notes takes list, then read
 * and append for each, which is eight calls and leaves no step to answer in.
 * Anything across more than two items was out of reach in the browser while
 * working fine everywhere else.
 *
 * Raised to cover ordinary multi-item work. It is not a licence to loop: the
 * sixty seconds still bind, and reaching this ceiling is now reported rather
 * than passed off as a finished answer.
 */
const MAX_STEPS = 24;
const MAX_HISTORY = 20;
// Bound one request's input tokens: a single oversized message cannot balloon
// the model bill. Generous for a real prompt, small enough to defeat abuse.
const MAX_MESSAGE_CHARS = 16_000;
const MAX_REQUEST_BODY_BYTES = 1_100_000;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;
const STREAM_HEADERS = {
  ...NO_STORE_HEADERS,
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "X-Accel-Buffering": "no",
} as const;
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

type AssistantViewContext = {
  level?: unknown;
  folderPath?: unknown;
  postId?: unknown;
  itemTitle?: unknown;
  selection?: unknown;
  itemPreview?: unknown;
  relatedItems?: unknown;
  attachments?: unknown;
  mode?: unknown;
};

function viewContext(value: unknown): AssistantViewContext {
  return value && typeof value === "object"
    ? (value as AssistantViewContext)
    : {};
}

function hasWorkspaceTurnContext(view: AssistantViewContext): boolean {
  if (
    typeof view.level === "string" &&
    /^(edit|folder|post|root|search|section|workspace)$/.test(view.level)
  ) {
    return true;
  }
  if (
    [
      view.folderPath,
      view.postId,
      view.itemTitle,
      view.selection,
      view.itemPreview,
    ].some((value) => typeof value === "string" && value.trim().length > 0)
  ) {
    return true;
  }
  return Array.isArray(view.relatedItems) && view.relatedItems.length > 0;
}

function messagesWithAttachments(
  messages: readonly ModelMessage[],
  context: unknown,
): ModelMessage[] {
  const view = viewContext(context);
  if (!Array.isArray(view.attachments)) return [...messages];
  const attachments: Exclude<UserContent, string> = [];
  for (const entry of view.attachments.slice(0, 4)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const candidate = entry as Record<string, unknown>;
    const dataUrl = typeof candidate.dataUrl === "string" ? candidate.dataUrl : "";
    const mediaType = typeof candidate.mediaType === "string" ? candidate.mediaType : "";
    const filename =
      typeof candidate.name === "string" && candidate.name.trim()
        ? candidate.name.trim().slice(0, 200)
        : "attachment.pdf";
    if (
      mediaType === "application/pdf" &&
      /^data:application\/pdf;base64,[A-Za-z0-9+/=\s]{1,1000000}$/i.test(
        dataUrl,
      )
    ) {
      attachments.push({
        type: "file",
        data: dataUrl,
        mediaType: "application/pdf",
        filename,
      });
      continue;
    }
    if (
      !/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{1,1000000}$/i.test(dataUrl) ||
      !/^image\/[a-z0-9.+-]+$/i.test(mediaType)
    ) {
      continue;
    }
    attachments.push({ type: "image", image: dataUrl });
  }
  if (attachments.length === 0) return [...messages];
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) return [...messages];
  const last = messages[lastUserIndex];
  if (last.role !== "user" || typeof last.content !== "string") {
    return [...messages];
  }
  const textContent = last.content as string;
  return messages.map((message, index) =>
    index === lastUserIndex
      ? {
          role: "user" as const,
          content: [
            { type: "text" as const, text: textContent },
            ...attachments,
          ],
        }
      : message,
  );
}

function fencedUntrusted(label: string, value: string): string {
  const escaped = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<${label}>\n${escaped}\n</${label}>`;
}

function lastUserText(messages: readonly ModelMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && typeof message.content === "string") {
      return message.content;
    }
  }
  return "";
}

function assistantToolProgress(toolName: string, finished = false): string {
  const label = toolName
    .replaceAll("__", " ")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim();
  return finished ? `Finished ${label}` : `Using ${label}`;
}

type AssistantStreamEvent =
  | { type: "start"; provider: string; model: string }
  | { type: "text"; text: string }
  | { type: "progress"; message: string; tool?: string }
  | {
      type: "complete";
      text: string;
      provider: string;
      model: string;
      outboundCalls: OutboundCallRecord[];
      unreachableServers: string[];
      workspaceCalls: CloudAssistantWorkspaceCall[];
      writeProposals?: CloudAssistantWriteProposal[];
      contextItems?: RecentWorkspaceContextItem[];
    }
  | {
      type: "error";
      message: string;
      partialText?: string;
      outboundCalls?: OutboundCallRecord[];
      unreachableServers?: string[];
      workspaceCalls?: CloudAssistantWorkspaceCall[];
      writeProposals?: CloudAssistantWriteProposal[];
    };

type StreamableAssistantResult = {
  fullStream: AsyncIterable<unknown>;
};

/**
 * What to say when the turn ran out of steps rather than finishing.
 *
 * Whatever the assistant already did is done and saved: the tools write as
 * they go. So the honest thing is to say the work is part done and name the
 * way forward, not to let a half-finished sweep read as a finished one.
 */
function truncationNotice(steps: number): string {
  if (steps < MAX_STEPS) return "";
  return "\n\nI ran out of steps before finishing this. Whatever I changed above is saved. Ask me to carry on with the rest and I will pick up where I stopped.";
}

function assistantStreamResponse(
  result: StreamableAssistantResult,
  {
    provider,
    model,
    calls,
    unreachable,
    workspaceCalls,
    writeProposals,
    contextItems,
    signal,
  }: {
    provider: string;
    model: string;
    calls: OutboundCallRecord[];
    unreachable: string[];
    workspaceCalls: CloudAssistantWorkspaceCall[];
    writeProposals: CloudAssistantWriteProposal[];
    contextItems: RecentWorkspaceContextItem[];
    signal: AbortSignal;
  },
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = "";
      let completed = false;
      let failed = false;
      // Reaching the step ceiling used to end the turn in silence. On a
      // request that touches several items that is the worst possible
      // outcome: some are changed, some are not, and the answer reads as if
      // the whole thing was done. Count the steps so the person is told.
      let steps = 0;
      const emit = (event: AssistantStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      emit({ type: "start", provider, model });
      try {
        for await (const rawPart of result.fullStream) {
          if (signal.aborted) break;
          const part = rawPart as Record<string, unknown>;
          const type = typeof part.type === "string" ? part.type : "";
          if (type === "text-delta" && typeof part.text === "string") {
            text += part.text;
            emit({ type: "text", text: part.text });
          } else if (
            type === "start-step" ||
            type === "finish-step" ||
            type === "start"
          ) {
            if (type === "start-step") steps += 1;
            emit({ type: "progress", message: "Thinking" });
          } else if (
            type === "tool-call" &&
            typeof part.toolName === "string"
          ) {
            emit({
              type: "progress",
              message: assistantToolProgress(part.toolName),
              tool: part.toolName,
            });
          } else if (
            type === "tool-result" &&
            typeof part.toolName === "string"
          ) {
            emit({
              type: "progress",
              message: assistantToolProgress(part.toolName, true),
              tool: part.toolName,
            });
          } else if (type === "error") {
            failed = true;
            emit({
              type: "error",
              message: "The assistant could not finish that.",
              partialText: text || undefined,
              outboundCalls: calls,
              unreachableServers: unreachable,
              workspaceCalls,
              ...(writeProposals.length > 0 ? { writeProposals } : {}),
            });
          } else if (type === "abort") {
            failed = true;
            emit({
              type: "error",
              message: "The assistant was stopped.",
              partialText: text || undefined,
              outboundCalls: calls,
              unreachableServers: unreachable,
              workspaceCalls,
              ...(writeProposals.length > 0 ? { writeProposals } : {}),
            });
          } else if (type === "finish") {
            completed = true;
            const cut = truncationNotice(steps);
            if (cut) {
              text += cut;
              emit({ type: "text", text: cut });
            }
            emit({
              type: "complete",
              text,
              provider,
              model,
              outboundCalls: calls,
              unreachableServers: unreachable,
              workspaceCalls,
              ...(writeProposals.length > 0 ? { writeProposals } : {}),
              ...(contextItems.length > 0 ? { contextItems } : {}),
            });
          }
        }
        if (!completed && !failed && !signal.aborted) {
          const cut = truncationNotice(steps);
          if (cut) {
            text += cut;
            emit({ type: "text", text: cut });
          }
          emit({
            type: "complete",
            text,
            provider,
            model,
            outboundCalls: calls,
            unreachableServers: unreachable,
            workspaceCalls,
            ...(writeProposals.length > 0 ? { writeProposals } : {}),
            ...(contextItems.length > 0 ? { contextItems } : {}),
          });
        }
      } catch {
        failed = true;
        if (!signal.aborted) {
          emit({
            type: "error",
            message: "The assistant could not finish that.",
            partialText: text || undefined,
            outboundCalls: calls,
            unreachableServers: unreachable,
            workspaceCalls,
            ...(writeProposals.length > 0 ? { writeProposals } : {}),
          });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200, headers: STREAM_HEADERS });
}

// Which words, in the PERSON'S OWN message, open the write tools for a turn.
//
// This is a trust boundary, not a convenience: untrusted item text reaches the
// model fenced inside the system prompt, and a turn that was only asked to
// summarize must not carry a tool an injected "call update_item now" could
// reach. Only what the person typed is read here.
//
// It is also a lexicon, so it has near misses, and a near miss used to be
// silent: "Give the reading log its own look" was not on the list, the whole
// write surface disappeared, and the assistant answered with something vague
// about having received the request. The list below is wider for that reason,
// and readOnlyTurnNote makes the remaining misses speak.
const WRITE_VERB =
  "add|append|apply|archive|attach|build|capture|categori[sz]e|change|clean|collect|convert|copy|create|delete|draft|duplicate|edit|extract|file|fix|generate|give|group|import|insert|jot|label|log|make|mark|merge|move|name|note|organi[sz]e|pin|produce|publish|put|recapture|record|remove|rename|reorder|replace|reshape|restructure|restyle|retitle|revise|rewrite|save|schedule|set|share|sort|split|star|start|store|style|tag|title|track|transform|trash|turn|unpin|unpublish|untag|update|write";
const DIRECT_WRITE_INTENT = new RegExp(`^\\s*(?:${WRITE_VERB})\\b`, "i");
const REQUESTED_WRITE_INTENT = new RegExp(
  `\\b(?:can you|could you|go ahead and|help me|how about you|i need you to|i want you to|i'?d like you to|i would like you to|let'?s|please|why don'?t you|would you)\\s+(?:${WRITE_VERB})\\b`,
  "i",
);
const RECENT_SUMMARY_INTENT =
  /\b(catch me up|latest|recent|recently|what (?:have|was|were|am|is)|working on|summari[sz]e (?:my|the) work)\b/i;

// "Give" is in the list above because "give this folder its own look" is a
// change. "Give me a summary" is not, and asking for something to be handed
// back has never been authorization to write, so that shape wins over the verb.
const HAND_ME_BACK =
  /\b(?:give|show|read|tell|hand)\s+(?:me|us)\s+(?:a|an|the)?\s*(?:summary|overview|recap|rundown|digest|answer|list|update|version)\b/i;

function cloudToolMode(
  messages: readonly ModelMessage[],
  context: unknown,
): "full" | "read_only" {
  const view = viewContext(context);
  if (view.mode === "suggestion") return "read_only";
  const request = lastUserText(messages);
  if (HAND_ME_BACK.test(request)) return "read_only";
  return DIRECT_WRITE_INTENT.test(request) ||
    REQUESTED_WRITE_INTENT.test(request)
    ? "full"
    : "read_only";
}

/**
 * What to tell the model when the turn carries no tool that changes anything.
 *
 * Without this the downgrade is invisible from both ends: the model has no
 * write tool, so it says something agreeable and stops, and the person reads
 * an answer that sounds like the work happened. A turn that cannot act should
 * say it cannot act.
 */
function readOnlyTurnNote(mode: CloudAssistantToolMode): string {
  if (mode !== "read_only") return "";
  return (
    "\n\nThis turn has no tools that change anything in the workspace. If the " +
    "person asked you to create, edit, move, or organize something, do not " +
    "imply that you did it. Say plainly that you did not make the change, and " +
    "that asking again as a direct instruction will let you."
  );
}

function recentItemIndex(
  entries: Awaited<ReturnType<typeof getAccessibleRecentPosts>>,
): string {
  return entries
    .slice(0, 12)
    .map(({ folderPath, post }) =>
      [
        `id: ${post.id ?? ""}`,
        `title: ${post.title?.trim() || "Untitled"}`,
        `folder: ${folderPath}`,
        `kind: ${post.type}`,
        post.updatedAt ? `updated: ${post.updatedAt}` : "",
        post.excerpt?.trim()
          ? `excerpt: ${post.excerpt.trim().slice(0, 360)}`
          : "",
        post.bodyPreview?.trim()
          ? `preview: ${post.bodyPreview.trim().slice(0, 360)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

type RecentWorkspaceContextItem = {
  id: string;
  title: string;
  folderPath: string;
  slug: string;
  /** A compact index proves discovery. Only a loaded body proves a read. */
  operation: "Found" | "Read";
};

async function recentWorkspaceContext({
  context,
  handle,
  messages,
  user,
}: {
  context: unknown;
  handle: string;
  messages: readonly ModelMessage[];
  user: AccessUser;
}): Promise<{ note: string; items: RecentWorkspaceContextItem[] }> {
  if (!RECENT_SUMMARY_INTENT.test(lastUserText(messages))) {
    return { note: "", items: [] };
  }
  const view = viewContext(context);
  if (typeof view.postId === "string" && view.postId) {
    return { note: "", items: [] };
  }
  const folderPath =
    typeof view.folderPath === "string" && view.folderPath.trim()
      ? view.folderPath.trim()
      : null;
  const entries = await getAccessibleRecentPosts(handle, user, {
    ...(folderPath ? { folderPath } : {}),
    limit: 12,
  });
  const index = recentItemIndex(entries);
  const note = [
    "A bounded, access-checked recent item index is included below. For a high-level recent-work summary, answer from this index immediately. Read an item only when the request needs detail the index does not contain.",
    fencedUntrusted(
      "UNTRUSTED_RECENT_ITEM_INDEX",
      index || "No recent items are visible in this scope.",
    ),
  ].join("\n\n");
  const items = entries.slice(0, 12).flatMap(({ folderPath, post }) =>
    post.id
      ? [
          {
            id: post.id,
            title: post.title?.trim() || "Untitled",
            folderPath,
            slug: post.slug,
            operation: "Found" as const,
          },
        ]
      : [],
  );
  return { note, items };
}

type RelatedWorkspaceContextItem = {
  id: string;
  title: string;
  body: string;
  slug: string;
};

async function relatedWorkspaceContext(
  context: unknown,
  handle: string,
): Promise<RelatedWorkspaceContextItem[]> {
  const view = viewContext(context);
  if (!Array.isArray(view.relatedItems)) return [];
  const ids = [
    ...new Set(
      view.relatedItems.slice(0, 4).flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const id = (entry as Record<string, unknown>).id;
        return typeof id === "string" && isUuid(id.trim()) ? [id.trim()] : [];
      }),
    ),
  ];
  const posts = await Promise.all(
    ids.map((id) => getPostById(handle, id).catch(() => null)),
  );
  return posts.flatMap((post) =>
    post?.id
      ? [
          {
            id: post.id,
            title: post.title?.trim() || "Untitled",
            body: post.body || "",
            slug: post.slug,
          },
        ]
      : [],
  );
}

function buildSystem(
  context: unknown,
  relatedItems: readonly RelatedWorkspaceContextItem[] = [],
): string {
  const view = viewContext(context);
  const bits: string[] = [];
  if (
    typeof view.level === "string" &&
    /^(edit|folder|post|root|search|section|workspace)$/.test(view.level)
  ) {
    bits.push(`level ${view.level}`);
  }
  if (
    typeof view.folderPath === "string" &&
    /^[a-z0-9/_-]{1,256}$/.test(view.folderPath)
  ) {
    bits.push(`folder ${view.folderPath}`);
  }
  if (
    typeof view.postId === "string" &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(view.postId)
  ) {
    bits.push(`current item id ${view.postId}`);
  }
  const head = bits.length
    ? `${SYSTEM}\n\nCurrent view: ${bits.join(", ")}.`
    : SYSTEM;
  // The text itself goes after the view line, bounded, so a request about
  // "this document" is answerable without a round trip and a long document
  // never dominates the prompt.
  const parts = [head];
  if (typeof view.itemTitle === "string" && view.itemTitle.trim()) {
    parts.push(
      "The current item has this untrusted title:",
      fencedUntrusted("UNTRUSTED_ITEM_TITLE", view.itemTitle.slice(0, 200)),
    );
  }
  if (typeof view.selection === "string" && view.selection.trim()) {
    parts.push(
      "The writer has selected the following untrusted workspace data:",
      fencedUntrusted("UNTRUSTED_SELECTION", view.selection.slice(0, 4000)),
    );
  }
  if (typeof view.itemPreview === "string" && view.itemPreview.trim()) {
    parts.push(
      "The current item begins with the following untrusted workspace data:",
      fencedUntrusted(
        "UNTRUSTED_ITEM_PREVIEW",
        view.itemPreview.slice(0, 4000),
      ),
      "Use read_item for the rest.",
    );
  }
  if (relatedItems.length > 0) {
    const related = relatedItems.map(
      (item) =>
        `id: ${item.id.slice(0, 128)}\ntitle: ${item.title.slice(0, 200)}\nbody:\n${item.body.slice(0, 6000)}`,
    );
    if (related.length > 0) {
      parts.push(
        "The writer explicitly added these TextText items as context:",
        fencedUntrusted("UNTRUSTED_ADDED_CONTEXT", related.join("\n\n")),
      );
    }
  }
  return parts.join(`\n\n`);
}

function requestWorkspaceHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().toLowerCase();
  return TENANT_HANDLE_RE.test(handle) ? handle : null;
}

export async function GET(request: Request) {
  const requestedHandle = requestWorkspaceHandle(
    new URL(request.url).searchParams.get("workspaceHandle"),
  );
  if (!requestedHandle) {
    return Response.json(
      { enabled: false, provider: null, model: null },
      { headers: NO_STORE_HEADERS },
    );
  }
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { enabled: false, provider: null, model: null },
      { headers: NO_STORE_HEADERS },
    );
  }
  const workspace = await getOwnedBlog(user.sub);
  if (!workspace || workspace.handle !== requestedHandle) {
    return Response.json(
      { enabled: false, provider: null, model: null },
      { headers: NO_STORE_HEADERS },
    );
  }
  const status = await getWorkspaceAiConfigStatusForOwner(user.sub);
  const enabled = status.configured;
  return Response.json(
    {
      enabled,
      provider:
        enabled && status.provider ? cloudProviderLabel(status.provider) : null,
      model: enabled ? status.model : null,
    },
    { headers: NO_STORE_HEADERS },
  );
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
  const decoded = await readBoundedJson<{
    messages?: unknown;
    context?: unknown;
    model?: unknown;
    stream?: unknown;
    workspaceHandle?: unknown;
  }>(request, MAX_REQUEST_BODY_BYTES);
  if ("error" in decoded && decoded.error === "too_large") {
    return Response.json(
      { error: "The assistant request is too large." },
      { status: 413, headers: NO_STORE_HEADERS },
    );
  }
  if ("error" in decoded) {
    return Response.json(
      { error: "Send a JSON body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const body = decoded.value;
  const requestedHandle = requestWorkspaceHandle(body.workspaceHandle);
  if (!requestedHandle || requestedHandle !== workspace.handle) {
    return Response.json(
      { error: "This AI connection is not available for this workspace." },
      { status: 403, headers: NO_STORE_HEADERS },
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
  const messages = coerceMessages(body.messages);
  if (messages.length === 0) {
    return Response.json({ error: "messages is required" }, { status: 400 });
  }
  const modelMessages = messagesWithAttachments(messages, body.context);

  const userId = user.userId ?? (await getUserIdBySub(user.sub));
  const actor = {
    sub: user.sub,
    userId: userId ?? null,
    handle: workspace.handle,
  };
  const provider = cloudProviderLabel(config.provider);
  // A turn may deliberately choose another model from the already-connected
  // provider. Never accept an arbitrary model id: the workspace catalog is the
  // allowlist, and an invalid value simply falls back to the saved default.
  const requestView = viewContext(body.context);
  const requestAttachments = Array.isArray(requestView.attachments)
    ? requestView.attachments
    : [];
  const requestRelatedItems = Array.isArray(requestView.relatedItems)
    ? requestView.relatedItems
    : [];
  const requestedModel =
    body.model === AUTO_CLOUD_AI_MODEL
      ? automaticCloudAiModel(config.provider, {
          request: lastUserText(messages),
          hasAttachments: requestAttachments.length > 0,
          hasWorkspaceContext:
            requestRelatedItems.length > 0 ||
            hasWorkspaceTurnContext(requestView),
        })
      : body.model;
  const selectedModel = isCloudAiModel(config.provider, requestedModel)
    ? requestedModel
    : config.model;

  // Outbound MCP: enabling a connection does not authorize background contact.
  // Only the connection invoked by its exact @mcp shortcut in the latest
  // request is discovered or injected; bare names and ordinary prose leave
  // every enabled server untouched.
  //
  // Requested discovery is cached per connection for as long as the server
  // says its list is good for (2026-07-28 added ttlMs). Before that this route
  // asked every connected server for its tool list on every message. That was
  // a round trip the person waited through to learn something that had not
  // changed.
  const workspaceRecord = await getBlogEditRecord(workspace.handle);
  const connections = workspaceRecord
    ? await enabledMcpConnections(workspaceRecord.id)
    : [];
  const requestedConnections = explicitlyRequestedOutboundConnections(
    lastUserText(messages),
    connections,
  );
  const reachable: Array<{
    connection: (typeof connections)[number];
    tools: RemoteTool[];
  }> = [];
  // A connected server that is down used to vanish silently, so the assistant
  // simply seemed unable to do what it did yesterday. Now the turn says so.
  const unreachable: string[] = [];
  await Promise.all(
    requestedConnections.map(async (connection) => {
      try {
        const tools = await discoverTools(connection);
        if (tools.length > 0) reachable.push({ connection, tools });
      } catch {
        unreachable.push(connection.name);
      }
    }),
  );
  const model = workspaceLanguageModel({ ...config, model: selectedModel });

  const calls: OutboundCallRecord[] = [];
  const workspaceCalls: CloudAssistantWorkspaceCall[] = [];
  const writeProposals: CloudAssistantWriteProposal[] = [];
  const remoteTools = guardedOutboundAssistantTools(
    actor,
    reachable,
    (proposal) => writeProposals.push(proposal),
  );
  const toolMode = cloudToolMode(messages, body.context);
  const [workspaceAgentPrompt, recentContext, relatedContext] =
    await Promise.all([
      workspaceAgentPromptForOwner(user.sub, messages).catch(() => ""),
      recentWorkspaceContext({
        context: body.context,
        handle: workspace.handle,
        messages,
        user,
      }).catch(() => ({ note: "", items: [] })),
      relatedWorkspaceContext(body.context, workspace.handle).catch(() => []),
    ]);
  const contextItems = [
    ...recentContext.items,
    ...relatedContext.map((item) => ({
      id: item.id,
      title: item.title,
      folderPath: "",
      slug: item.slug,
      operation: "Read" as const,
    })),
  ].reduce<RecentWorkspaceContextItem[]>((items, item) => {
    const existing = items.findIndex((candidate) => candidate.id === item.id);
    if (existing < 0) return [...items, item];
    if (items[existing].operation === "Found" && item.operation === "Read") {
      return items.map((candidate, index) =>
        index === existing ? item : candidate,
      );
    }
    return items;
  }, []);

  const tools = {
    ...guardedCloudAssistantTools(
      actor,
      (proposal) => writeProposals.push(proposal),
      (call) => workspaceCalls.push(call),
      toolMode,
    ),
    // Remote tools remain visible so the model can stage the exact requested
    // arguments. No server-supplied safety hint permits execution in this
    // turn: every external call becomes a durable owner review proposal.
    ...remoteTools,
  };
  const modelRequest = {
    model,
    system:
      buildSystem(body.context, relatedContext) +
      (recentContext.note ? `\n\n${recentContext.note}` : "") +
      (workspaceAgentPrompt ? `\n\n${workspaceAgentPrompt}` : "") +
      outboundSystemNote(
        reachable.map((entry) => entry.connection.name),
        unreachable,
      ) +
      readOnlyTurnNote(toolMode),
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  };

  const wantsStream =
    body.stream === true ||
    request.headers.get("accept")?.includes("text/event-stream") === true;
  if (wantsStream) {
    const streamed = streamText({
      ...modelRequest,
      abortSignal: request.signal,
      // AI SDK's default handler logs the raw provider error object. Provider
      // errors can contain request metadata, so keep the public stream generic
      // and never write that object to server logs.
      onError: () => {},
    });
    return assistantStreamResponse(streamed, {
      provider,
      model: selectedModel,
      calls,
      unreachable,
      workspaceCalls,
      writeProposals,
      contextItems,
      signal: request.signal,
    });
  }

  try {
    const result = await generateText({
      ...modelRequest,
    });
    return Response.json({
      text: result.text,
      provider,
      model: selectedModel,
      // What the assistant did on machines this workspace does not control.
      // The conversation shows these, because a remote side effect the person
      // cannot see is one they cannot object to.
      outboundCalls: calls,
      unreachableServers: unreachable,
      // Validated workspace-command results, never model prose. The client
      // reduces these to exact item receipts with Open when resolvable.
      workspaceCalls,
      ...(writeProposals.length > 0 ? { writeProposals } : {}),
      // Exact access-checked items supplied to the model for this summary.
      // This is source proof, not an inference from the reply.
      ...(contextItems.length > 0
        ? { contextItems }
        : {}),
    });
  } catch {
    // Provider errors can carry request metadata. Do not log the error object,
    // because a user-supplied API key must never reach logs.
    console.error("cloud assistant turn failed");
    if (
      workspaceCalls.length > 0 ||
      writeProposals.length > 0 ||
      calls.some((call) => call.status === "ok")
    ) {
      return Response.json({
        text: "",
        provider,
        model: selectedModel,
        outboundCalls: calls,
        unreachableServers: unreachable,
        workspaceCalls,
        ...(writeProposals.length > 0 ? { writeProposals } : {}),
        ...(contextItems.length > 0
          ? { contextItems }
          : {}),
        terminalError:
          writeProposals.length > 0 &&
          workspaceCalls.length === 0 &&
          !calls.some((call) => call.status === "ok")
            ? "A proposed change is ready for review, but the assistant stopped before it could finish the reply."
            : "Some actions completed, but the assistant stopped before it could finish the reply.",
      });
    }
    return Response.json(
      { error: "The assistant could not complete that." },
      { status: 502 },
    );
  }
}
