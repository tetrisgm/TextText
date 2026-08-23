"use client";

// The assistant's workspace-scoped provider client. It routes requests to the
// Anthropic or OpenAI connection selected by the workspace owner and keeps one
// transcript per context: the root, each folder, and each item own a thread.
//
// Transcripts live in a module store mirrored to sessionStorage, so they
// survive component remounts, route changes (the full editor is a different
// route), and pool refreshes. A reply always lands in the thread that
// SUBMITTED it, even if the user navigates elsewhere while the model works.
//
// Credentials remain server-side. The browser only receives provider metadata.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createWorkspaceAgentTools } from "@/lib/ai/agent-tools";
import {
  cloudAssistantTurn,
  submitAssistantFeedback,
  type CloudAssistantStreamEvent,
  type CloudContextItem,
  type CloudWorkspaceCall,
  type OutboundCall,
  cloudAssistantStatus,
  type CloudAssistantProviderLabel,
} from "@/lib/ai/cloud-client";
import {
  NATIVE_QUICK_ACTIONS,
  type NativeQuickActionField,
  type NativeQuickActionId,
  type NativeQuickActionScope,
} from "@/lib/ai/quick-actions";
import {
  createWorkspaceItemTextEdit,
  resolveWorkspaceItemTextSelection,
  type WorkspaceItemTextEdit,
  type WorkspaceItemTextSelection,
  type WorkspaceItemTextPatch,
  type WorkspaceItemTextSnapshot,
} from "@/lib/ai/workspace-item-draft";
import {
  assistantJobs,
  runningAssistantJobCount,
  startAssistantJob,
  subscribeAssistantJobs,
  updateAssistantJob,
} from "@/lib/ai/jobs";
import {
  loadLocalTools,
  localConnectionsFrom,
  type LocalToolSet,
} from "@/lib/mcp/local-tools";
import { getMcpConnectionsAction } from "@/app/editor/mcp-connection-actions";
import { findPoolPostById } from "@/lib/pool/selectors";
import type { WorkspacePoolPayload, WorkspacePoolPost } from "@/lib/pool/types";
import { normalizeTags } from "@/lib/tags";
import type { AssistantAttachment } from "./AssistantSidebar";
import {
  assistantAttachmentAccept,
  buildCloudAssistantPrompt,
  buildCloudAssistantAttachments,
  buildNativeAssistantPrompt,
  formatAssistantSubmission,
} from "./attachments";
import { type AssistantViewSnapshot } from "./context";
import {
  nativeAssistantAvailable,
  registerNativeAssistantTools,
  requestNativeAssistant,
  subscribeNativeAssistant,
  submitNativeAssistantToolResult,
  submitNativeAssistantTurn,
} from "@/lib/ai/native-client";
import {
  NATIVE_ITEM_TYPE_PREVIEW_TOOL,
  NATIVE_ITEM_TYPE_PREVIEW_TOOL_NAME,
  nativeItemTypeDesignPrompt,
  parseNativeItemTypePreviewArguments,
} from "@/lib/ai/native-item-type";
import type { AiConnectionSnapshot } from "@/lib/ai/connection-state";
import type { ItemTypeBlueprint } from "@/lib/presentation/item-type-blueprint";
import {
  nativeAssistantTurnPrompt,
  nativeWorkspaceIndex,
} from "@/lib/ai/native-turn";
import { workspaceToolProgress } from "./tool-progress";
import {
  itemArtifactProof,
  loadedContextArtifactProofs,
  mergeArtifactProofs,
  workspaceToolArtifactProofs,
  type AssistantArtifactProof,
} from "./artifact-proof";

export type { AssistantViewSnapshot } from "./context";

export type AssistantMessageRole = "user" | "assistant" | "progress" | "error";

type AssistantProposalBase = {
  itemId: string;
  label: string;
  canApply: boolean;
  note?: string;
  status: "pending" | "applying" | "applied" | "undoing" | "undone";
  syncPending?: boolean;
};

export type AssistantProposal = AssistantProposalBase &
  (
    | {
        kind?: "text";
        field: NativeQuickActionField;
        before: string;
        after: string;
        source?: string;
        result?: string;
        range?: WorkspaceItemTextEdit["range"];
        scope?: NativeQuickActionScope;
      }
    | {
        kind: "tags";
        beforeTags: string[];
        afterTags: string[];
        addedTags: string[];
      }
  );

export type AssistantMessage = {
  id: string;
  role: AssistantMessageRole;
  text: string;
  provider?: CloudAssistantProviderLabel;
  model?: string;
  proposal?: AssistantProposal;
  /**
   * What this turn did on machines the workspace does not control, and which
   * connected servers were unreachable. Attached to the message rather than
   * kept beside the thread so it survives reload with the words it explains.
   */
  outbound?: { calls: OutboundCall[]; unreachable: string[] };
  /**
   * Inspectable TextText items the completed turn actually read or changed.
   * These come from the frozen view or a validated workspace command result,
   * never from the model's prose.
   */
  artifactProofs?: AssistantArtifactProof[];
  /** A durable save receipt for a reply captured into Notes. */
  savedItem?: { id: string; title: string };
  feedback?: "up" | "down";
};

type UseNativeAssistantOptions = {
  handle: string;
  contextKey: string;
  getPool: () => WorkspacePoolPayload | null;
  getView: () => AssistantViewSnapshot;
  openItem: (
    post: WorkspacePoolPost,
    mode: "read" | "edit",
  ) => Promise<void> | void;
  readItemText: (postId: string) => Promise<WorkspaceItemTextSnapshot>;
  applyItemPatch: (
    postId: string,
    patch: WorkspaceItemTextPatch,
    expected?: WorkspaceItemTextPatch,
    ifMatchHash?: string,
  ) =>
    | Promise<{ queued?: boolean; synced: boolean } | void>
    | { queued?: boolean; synced: boolean }
    | void;
  confirmDestructive?: (description: string) => Promise<boolean> | boolean;
};

function cloudWorkspaceProofs(
  calls: readonly CloudWorkspaceCall[],
  pool: WorkspacePoolPayload | null,
): AssistantArtifactProof[] {
  return calls.reduce<AssistantArtifactProof[]>((proofs, call) => {
    return mergeArtifactProofs(
      proofs,
      workspaceToolArtifactProofs({
        args: call.args,
        output: call.output,
        pool,
        tool: call.tool,
      }),
    );
  }, []);
}

function cloudContextProofs(
  items: readonly CloudContextItem[],
  pool: WorkspacePoolPayload | null,
): AssistantArtifactProof[] {
  if (!pool) return [];
  return items.flatMap((item) => {
    const proof = itemArtifactProof({
      folderPath: item.folderPath,
      id: item.id,
      operation: "Read",
      pool,
      slug: item.slug,
      title: item.title,
    });
    return proof ? [proof] : [];
  });
}

const RECENT_WORKSPACE_REQUEST =
  /\b(catch me up|latest|recent|recently|working on|summari[sz]e (?:my|the) work)\b/i;

function nativeIndexProofs(
  prompt: string,
  pool: WorkspacePoolPayload | null,
): AssistantArtifactProof[] {
  if (!pool || !RECENT_WORKSPACE_REQUEST.test(prompt)) return [];
  return [...pool.posts]
    .sort((left, right) =>
      (right.updatedAt ?? right.createdAt ?? "").localeCompare(
        left.updatedAt ?? left.createdAt ?? "",
      ),
    )
    .slice(0, 12)
    .flatMap((post) => {
      const proof = itemArtifactProof({
        id: post.id,
        operation: "Read",
        pool,
        title: post.title,
      });
      return proof ? [proof] : [];
    });
}

function workspaceMutationQueued(output: unknown): boolean {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return false;
  }
  const result = output as Record<string, unknown>;
  return (
    result.queued === true ||
    result.sync_status === "queued_locally" ||
    result.ok === false
  );
}

function completedWorkspaceProofs({
  args,
  output,
  pool,
  tool,
}: {
  args: Record<string, unknown>;
  output: unknown;
  pool: WorkspacePoolPayload | null;
  tool: string;
}): AssistantArtifactProof[] {
  if (workspaceMutationQueued(output)) return [];
  return workspaceToolArtifactProofs({ args, output, pool, tool });
}

function assistantAgentError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    /\babort(?:ed|ing)?\b/i.test(message)
  ) {
    return "The assistant was stopped.";
  }
  if (
    /Pass either markdown or a title|invalid_type|too_small|unrecognized_keys/i.test(
      message,
    )
  ) {
    return "The assistant chose an action that did not fit this item. Try the request again.";
  }
  return message.trim() || "The assistant could not finish that.";
}

// ---- Per-context transcript store (module scope, sessionStorage mirror) ----

const MAX_MESSAGES_PER_THREAD = 200;
const EMPTY_TRANSCRIPT: AssistantMessage[] = [];
const transcripts = new Map<string, AssistantMessage[]>();
const busyThreads = new Set<string>();
const cloudProviderByThread = new Map<string, CloudAssistantProviderLabel>();
const listeners = new Set<() => void>();
let messageCounter = 0;

function nextMessageId(): string {
  messageCounter += 1;
  return `m${Date.now().toString(36)}_${messageCounter}`;
}

function storageKey(threadKey: string): string {
  return `texttext:assistant:${threadKey}`;
}

function threadFor(threadKey: string): AssistantMessage[] {
  const existing = transcripts.get(threadKey);
  if (existing) return existing;
  let restored: AssistantMessage[] = [];
  try {
    const raw = sessionStorage.getItem(storageKey(threadKey));
    if (raw) restored = JSON.parse(raw) as AssistantMessage[];
  } catch {
    // Session storage is best effort; an empty thread is a valid start.
  }
  transcripts.set(threadKey, restored);
  return restored;
}

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Start over in this context without leaving it.
 *
 * A transcript is keyed to where the person is, so before this the only way to
 * get a clean one was to navigate somewhere else and come back. That makes the
 * rail feel like it is holding onto an argument you already finished.
 *
 * The stored copy goes too, otherwise the old transcript reappears on the next
 * render from session storage.
 */
function clearThread(threadKey: string) {
  transcripts.set(threadKey, []);
  try {
    sessionStorage.removeItem(storageKey(threadKey));
  } catch {
    // Session storage is best effort; the in-memory clear is what matters.
  }
  notify();
}

function appendToThread(
  threadKey: string,
  role: AssistantMessageRole,
  text: string,
  proposal?: AssistantProposal,
  provider?: CloudAssistantProviderLabel,
  outbound?: AssistantMessage["outbound"],
  artifactProofs?: AssistantArtifactProof[],
): string {
  const id = nextMessageId();
  const next = [
    ...threadFor(threadKey),
    { id, role, text, proposal, provider, outbound, artifactProofs },
  ].slice(-MAX_MESSAGES_PER_THREAD);
  transcripts.set(threadKey, next);
  try {
    sessionStorage.setItem(storageKey(threadKey), JSON.stringify(next));
  } catch {
    // Quota or private mode: the in-memory thread still works.
  }
  notify();
  return id;
}

function updateThreadMessage(
  threadKey: string,
  messageId: string,
  update: (message: AssistantMessage) => AssistantMessage,
) {
  const next = threadFor(threadKey).map((message) =>
    message.id === messageId ? update(message) : message,
  );
  transcripts.set(threadKey, next);
  try {
    sessionStorage.setItem(storageKey(threadKey), JSON.stringify(next));
  } catch {
    // The in-memory transcript remains authoritative for this session.
  }
  notify();
}

function setThreadBusy(threadKey: string, busy: boolean) {
  if (busy) busyThreads.add(threadKey);
  else busyThreads.delete(threadKey);
  notify();
}

function setThreadCloudProvider(
  threadKey: string,
  provider: CloudAssistantProviderLabel | null,
) {
  if (provider) cloudProviderByThread.set(threadKey, provider);
  else cloudProviderByThread.delete(threadKey);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Turn a quick action's answer into something the writer can apply and undo,
 * rather than text they have to copy by hand.
 *
 * Summarize is deliberately excluded: a summary is a thing to read, and
 * applying it over the text it summarises would delete the document.
 */
function quickActionProposal({
  action,
  actionLabel,
  item,
  itemId,
  selection,
  text,
}: {
  action: string;
  actionLabel: string;
  item: WorkspaceItemTextSnapshot;
  itemId: string;
  selection: WorkspaceItemTextSelection | null;
  text: string;
}): AssistantProposal | undefined {
  const after = text.trim();
  if (!after) return undefined;

  if (action === "tags") {
    const beforeTags = normalizeTags(item.tags ?? []);
    const suggested = normalizeTags(
      after
        .split(/[\n,]/)
        .map((entry) => entry.replace(/^[-*\s#]+/, "").trim())
        .filter(Boolean),
    );
    const afterTags = normalizeTags([...beforeTags, ...suggested]);
    const addedTags = afterTags.filter((tag) => !beforeTags.includes(tag));
    if (addedTags.length === 0) return undefined;
    return {
      itemId,
      label: actionLabel,
      canApply: true,
      status: "pending",
      kind: "tags",
      beforeTags,
      afterTags,
      addedTags,
    };
  }

  const field: NativeQuickActionField | null =
    action === "title"
      ? "title"
      : action === "excerpt"
        ? "excerpt"
        : action === "rewrite"
          ? (selection?.field ?? "body")
          : action === "structure"
            ? "body"
            : null;
  if (!field) return undefined;

  const source = item[field] ?? "";
  const range =
    selection && selection.field === field
      ? { start: selection.start, end: selection.end }
      : { start: 0, end: source.length };
  const before = source.slice(range.start, range.end);
  if (before === after) return undefined;

  return {
    itemId,
    label: actionLabel,
    canApply: true,
    status: "pending",
    kind: "text",
    field,
    before,
    after,
    source,
    range,
    scope: selection && selection.field === field ? "selection" : "field",
  };
}

function proposalEdit(
  proposal: AssistantProposal,
): WorkspaceItemTextEdit | null {
  if (proposal.kind === "tags") return null;
  const source = proposal.source ?? proposal.before;
  const range = proposal.range ?? { start: 0, end: source.length };
  const edit = createWorkspaceItemTextEdit({
    after: proposal.after,
    end: range.end,
    field: proposal.field,
    source,
    start: range.start,
  });
  if (
    !edit ||
    (proposal.result !== undefined && edit.result !== proposal.result)
  ) {
    return null;
  }
  return edit;
}

export function useNativeAssistant({
  handle,
  contextKey,
  getPool,
  getView,
  openItem,
  readItemText,
  applyItemPatch,
  confirmDestructive,
}: UseNativeAssistantOptions) {
  const [cloudProvider, setCloudProvider] =
    useState<CloudAssistantProviderLabel | null>(null);
  const [nativeConnection, setNativeConnection] =
    useState<AiConnectionSnapshot | null>(null);
  const [savingAnswerId, setSavingAnswerId] = useState<string | null>(null);
  const nativeJobRef = useRef<string | null>(null);
  const nativeMessageRef = useRef<string | null>(null);
  const activeCloudAbortRef = useRef<AbortController | null>(null);
  const nativeProofsRef = useRef<AssistantArtifactProof[]>([]);
  const nativeItemTypeDesignRef = useRef<{
    blueprint: ItemTypeBlueprint | null;
    lastError: string | null;
    reject: (error: Error) => void;
    resolve: (blueprint: ItemTypeBlueprint) => void;
    request: string;
    timeout: ReturnType<typeof setTimeout>;
  } | null>(null);
  const getPoolRef = useRef(getPool);
  const getViewRef = useRef(getView);
  const readItemTextRef = useRef(readItemText);
  const applyItemPatchRef = useRef(applyItemPatch);
  const threadKey = `${handle}:${contextKey}`;

  useEffect(() => {
    getPoolRef.current = getPool;
    getViewRef.current = getView;
    readItemTextRef.current = readItemText;
    applyItemPatchRef.current = applyItemPatch;
  }, [applyItemPatch, getPool, getView, readItemText]);

  const messages = useSyncExternalStore(
    subscribe,
    () => threadFor(threadKey),
    // The server cannot see sessionStorage. Hydration must replay that same
    // empty snapshot before React switches to the live client snapshot, which
    // restores the saved transcript. Reading storage here made the client add
    // the New chat control while it was hydrating markup that only had the
    // close control.
    () => EMPTY_TRANSCRIPT,
  );
  const submitting = useSyncExternalStore(
    subscribe,
    () => busyThreads.has(threadKey),
    () => false,
  );
  const activeCloudProvider = useSyncExternalStore(
    subscribe,
    () => cloudProviderByThread.get(threadKey) ?? null,
    () => null,
  );

  const tools = useMemo(
    () =>
      createWorkspaceAgentTools({
        handle,
        getPool,
        openItem,
        readItemText,
        applyItemPatch,
        confirmDestructive: (description) =>
          confirmDestructive ? confirmDestructive(description) : false,
      }),
    [
      applyItemPatch,
      confirmDestructive,
      getPool,
      handle,
      openItem,
      readItemText,
    ],
  );

  /**
   * What the connected servers on this Mac offer, discovered once per mount.
   *
   * A ref rather than state on purpose: the tool-call handler reads it, and
   * rebuilding that subscription every time discovery finishes would drop
   * in-flight calls. Discovery failing is normal, the design app is closed, and
   * costs nothing but those tools.
   */
  const localToolsRef = useRef<LocalToolSet>({
    definitions: [],
    connectionNames: [],
    unreachable: [],
    run: () => null,
  });
  const [localToolsVersion, setLocalToolsVersion] = useState(0);

  useEffect(() => {
    if (!nativeAssistantAvailable()) return;
    let cancelled = false;
    void (async () => {
      try {
        const state = await getMcpConnectionsAction(handle);
        const local = localConnectionsFrom(state.connections);
        if (local.length === 0) return;
        const loaded = await loadLocalTools(local);
        if (cancelled) return;
        localToolsRef.current = loaded;
        // Re-register so the assistant is offered them.
        setLocalToolsVersion((current) => current + 1);
      } catch {
        // No connections, or the settings action refused: nothing local to add.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  useEffect(() => {
    if (nativeAssistantAvailable()) {
      // Workspace tools, plus whatever the connected servers on THIS Mac offer.
      // The hosted rung cannot include those: a server in a data centre
      // fetching 127.0.0.1 reaches itself, so a local design tool is only ever
      // reachable from here.
      registerNativeAssistantTools([
        NATIVE_ITEM_TYPE_PREVIEW_TOOL,
        ...tools.toolDefinitions.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        })),
        ...localToolsRef.current.definitions,
      ]);
    }
    const unsubscribe = subscribeNativeAssistant((event) => {
      if (event.type === "status") {
        setNativeConnection((current) => ({
          state: event.state ?? current?.state ?? "unavailable",
          kind: event.kind ?? current?.kind ?? "native-codex",
          providerLabel:
            event.providerLabel ??
            current?.providerLabel ??
            "Codex with ChatGPT",
          accountEmail: event.accountEmail ?? current?.accountEmail ?? null,
          planLabel: event.planLabel ?? current?.planLabel ?? null,
          runtimeVersion:
            event.runtimeVersion ?? current?.runtimeVersion ?? null,
          rateLimitResetAt:
            event.rateLimitResetAt ?? current?.rateLimitResetAt ?? null,
          lastHealthCheckAt:
            event.lastHealthCheckAt ?? current?.lastHealthCheckAt ?? null,
          embeddedChatSupported:
            event.embeddedChatSupported ??
            current?.embeddedChatSupported ??
            false,
          recoveryAction:
            event.recoveryAction ?? current?.recoveryAction ?? null,
        }));
      } else if (event.type === "text-delta") {
        if (nativeItemTypeDesignRef.current) return;
        if (nativeMessageRef.current) {
          updateThreadMessage(
            threadKey,
            nativeMessageRef.current,
            (message) => ({
              ...message,
              text: message.text + event.text,
            }),
          );
        } else {
          nativeMessageRef.current = appendToThread(
            threadKey,
            "assistant",
            event.text,
            undefined,
            "OpenAI",
            undefined,
            nativeProofsRef.current,
          );
        }
      } else if (event.type === "final-text") {
        if (nativeItemTypeDesignRef.current) return;
        if (nativeMessageRef.current) {
          updateThreadMessage(
            threadKey,
            nativeMessageRef.current,
            (message) => ({
              ...message,
              text: event.text,
            }),
          );
        } else {
          nativeMessageRef.current = appendToThread(
            threadKey,
            "assistant",
            event.text,
            undefined,
            "OpenAI",
            undefined,
            nativeProofsRef.current,
          );
        }
      } else if (event.type === "tool-call") {
        if (
          nativeItemTypeDesignRef.current &&
          event.tool !== NATIVE_ITEM_TYPE_PREVIEW_TOOL_NAME
        ) {
          submitNativeAssistantToolResult(
            event.callId,
            {
              error:
                "This turn is preview-only. Return the design with preview_item_type.",
            },
            true,
          );
          return;
        }
        if (event.tool === NATIVE_ITEM_TYPE_PREVIEW_TOOL_NAME) {
          const pending = nativeItemTypeDesignRef.current;
          if (!pending) {
            submitNativeAssistantToolResult(
              event.callId,
              { error: "No item-type preview is waiting for a design." },
              true,
            );
            return;
          }
          try {
            pending.blueprint = parseNativeItemTypePreviewArguments(
              event.arguments,
              pending.request,
            );
            pending.lastError = null;
            submitNativeAssistantToolResult(event.callId, {
              accepted: true,
              message:
                "The preview is ready. Finish the turn without calling another tool.",
            });
          } catch (error) {
            pending.lastError = assistantAgentError(error);
            submitNativeAssistantToolResult(
              event.callId,
              { error: pending.lastError },
              true,
            );
          }
          return;
        }
        void (async () => {
          try {
            const args =
              typeof event.arguments === "string"
                ? JSON.parse(event.arguments)
                : event.arguments;
            const progress = workspaceToolProgress(
              event.tool,
              (args ?? {}) as Record<string, unknown>,
            );
            if (progress) {
              appendToThread(threadKey, "progress", progress);
              if (nativeJobRef.current) {
                updateAssistantJob(nativeJobRef.current, {
                  activity: progress,
                });
              }
            }
            // A namespaced name belongs to a connected server, not the
            // workspace, and runs through the local bridge instead.
            const local = localToolsRef.current.run(
              event.tool,
              (args ?? {}) as Record<string, unknown>,
            );
            const output = local
              ? await local
              : await tools.executor(event.tool as never, args as never);
            const proofs = completedWorkspaceProofs({
              args: (args ?? {}) as Record<string, unknown>,
              output,
              pool: getPoolRef.current(),
              tool: event.tool,
            });
            if (proofs.length > 0) {
              nativeProofsRef.current = mergeArtifactProofs(
                nativeProofsRef.current,
                proofs,
              );
              if (nativeMessageRef.current) {
                updateThreadMessage(
                  threadKey,
                  nativeMessageRef.current,
                  (message) => ({
                    ...message,
                    artifactProofs: mergeArtifactProofs(
                      message.artifactProofs,
                      proofs,
                    ),
                  }),
                );
              }
            }
            submitNativeAssistantToolResult(event.callId, output);
          } catch (error) {
            submitNativeAssistantToolResult(
              event.callId,
              { error: assistantAgentError(error) },
              true,
            );
          }
        })();
      } else if (event.type === "turn-completed") {
        const itemTypeDesign = nativeItemTypeDesignRef.current;
        if (itemTypeDesign) {
          clearTimeout(itemTypeDesign.timeout);
          nativeItemTypeDesignRef.current = null;
          setThreadBusy(threadKey, false);
          if (itemTypeDesign.blueprint) {
            itemTypeDesign.resolve(itemTypeDesign.blueprint);
          } else {
            itemTypeDesign.reject(
              new Error(
                itemTypeDesign.lastError ||
                  "The connected agent finished without a usable item-type design.",
              ),
            );
          }
          return;
        }
        if (nativeProofsRef.current.length > 0) {
          if (nativeMessageRef.current) {
            updateThreadMessage(
              threadKey,
              nativeMessageRef.current,
              (message) => ({
                ...message,
                artifactProofs: mergeArtifactProofs(
                  message.artifactProofs,
                  nativeProofsRef.current,
                ),
              }),
            );
          } else {
            nativeMessageRef.current = appendToThread(
              threadKey,
              "assistant",
              "Done.",
              undefined,
              "OpenAI",
              undefined,
              nativeProofsRef.current,
            );
          }
        }
        if (nativeJobRef.current)
          updateAssistantJob(nativeJobRef.current, { status: "done" });
        nativeJobRef.current = null;
        nativeMessageRef.current = null;
        nativeProofsRef.current = [];
        setThreadBusy(threadKey, false);
      } else if (event.type === "error") {
        const itemTypeDesign = nativeItemTypeDesignRef.current;
        if (itemTypeDesign) {
          clearTimeout(itemTypeDesign.timeout);
          nativeItemTypeDesignRef.current = null;
          setThreadBusy(threadKey, false);
          itemTypeDesign.reject(new Error(assistantAgentError(event.message)));
          return;
        }
        if (nativeProofsRef.current.length > 0) {
          if (nativeMessageRef.current) {
            updateThreadMessage(
              threadKey,
              nativeMessageRef.current,
              (message) => ({
                ...message,
                artifactProofs: mergeArtifactProofs(
                  message.artifactProofs,
                  nativeProofsRef.current,
                ),
              }),
            );
          } else {
            nativeMessageRef.current = appendToThread(
              threadKey,
              "assistant",
              "Some actions completed before the assistant stopped.",
              undefined,
              "OpenAI",
              undefined,
              nativeProofsRef.current,
            );
          }
        }
        appendToThread(threadKey, "error", assistantAgentError(event.message));
        if (nativeJobRef.current)
          updateAssistantJob(nativeJobRef.current, { status: "error" });
        nativeJobRef.current = null;
        nativeMessageRef.current = null;
        nativeProofsRef.current = [];
        setThreadBusy(threadKey, false);
      }
    });
    if (nativeAssistantAvailable()) requestNativeAssistant("assistantStatus");
    return unsubscribe;
  }, [threadKey, tools, localToolsVersion]);

  const generateItemTypeBlueprint = useCallback(
    ({
      current,
      folderName,
      request,
    }: {
      current?: ItemTypeBlueprint;
      folderName?: string;
      request: string;
    }) => {
      if (nativeConnection?.state !== "ready") {
        return Promise.reject(
          new Error("Connect the TextText Agent before building with it."),
        );
      }
      if (busyThreads.has(threadKey) || nativeItemTypeDesignRef.current) {
        return Promise.reject(
          new Error(
            "The connected agent is already working. Try again in a moment.",
          ),
        );
      }
      return new Promise<ItemTypeBlueprint>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!nativeItemTypeDesignRef.current) return;
          nativeItemTypeDesignRef.current = null;
          setThreadBusy(threadKey, false);
          reject(
            new Error(
              "The connected agent took too long to design that item type.",
            ),
          );
        }, 120_000);
        nativeItemTypeDesignRef.current = {
          blueprint: null,
          lastError: null,
          reject,
          resolve,
          request,
          timeout,
        };
        setThreadBusy(threadKey, true);
        const started = submitNativeAssistantTurn(
          nativeItemTypeDesignPrompt({ current, folderName, request }),
        );
        if (!started) {
          clearTimeout(timeout);
          nativeItemTypeDesignRef.current = null;
          setThreadBusy(threadKey, false);
          reject(new Error("The connected agent could not start that design."));
        }
      });
    },
    [nativeConnection?.state, threadKey],
  );

  useEffect(() => {
    let cancelled = false;
    void cloudAssistantStatus()
      .then((status) => {
        if (!cancelled) {
          setCloudProvider(status.enabled ? status.provider : null);
        }
      })
      .catch(() => {
        if (!cancelled) setCloudProvider(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const contextLabel = useCallback(() => {
    const view = getViewRef.current();
    if (view.level === "post" || view.level === "edit") {
      const pool = getPoolRef.current();
      const post =
        pool && view.postId ? findPoolPostById(pool, view.postId) : null;
      return post?.title?.trim() || "Untitled";
    }
    if (view.folderPath) {
      const pool = getPoolRef.current();
      const folder = pool?.folders.find(
        (candidate) => candidate.path === view.folderPath,
      );
      return folder?.name ?? view.folderPath;
    }
    return "Workspace";
  }, []);

  const submit = useCallback(
    async (text: string, attachments: readonly AssistantAttachment[] = []) => {
      const prompt = text.trim();
      // One request per thread at a time; different threads run in parallel.
      // Replies and job updates land in the thread that asked, even if the
      // user navigates away while the model works.
      const thread = threadKey;
      if ((!prompt && attachments.length === 0) || busyThreads.has(thread)) {
        return;
      }
      const modelPrompt =
        prompt ||
        (attachments.some((attachment) => attachment.workspaceItemId)
          ? "Review the added TextText context."
          : "Review the attached content.");
      const displayPrompt = formatAssistantSubmission(prompt, attachments);
      const submittedView = getViewRef.current();
      appendToThread(thread, "user", displayPrompt);
      setThreadBusy(thread, true);
      const jobId = startAssistantJob({
        threadKey: thread,
        contextKey,
        contextLabel: contextLabel(),
        prompt: displayPrompt,
      });
      try {
        const localAttachments = attachments.filter(
          (attachment) => !attachment.workspaceItemId,
        );
        const nativeReady = nativeConnection?.state === "ready";
        const cloudAttachments = nativeReady
          ? []
          : await buildCloudAssistantAttachments(attachments);
        const preparedPrompt = nativeReady
          ? localAttachments.length > 0
            ? (
                await buildNativeAssistantPrompt(modelPrompt, localAttachments)
              ).prompt
            : modelPrompt
          : await buildCloudAssistantPrompt(modelPrompt, attachments);
        const relatedItems = (
          await Promise.all(
            attachments
              .filter((attachment) => attachment.workspaceItemId)
              .slice(0, 4)
              .map(async (attachment) => {
                const id = attachment.workspaceItemId;
                if (!id) return null;
                const item = await readItemTextRef.current(id).catch(() => null);
                return item
                  ? {
                      id,
                      title: item.title.trim() || attachment.name,
                      body: item.body.slice(0, 6000),
                    }
                  : null;
              }),
          )
        ).filter(
          (item): item is { body: string; id: string; title: string } =>
            Boolean(item),
        );
        if (nativeConnection?.state === "ready") {
          const open = submittedView.postId
            ? await readItemTextRef
                .current(submittedView.postId)
                .catch(() => null)
            : null;
          const openSelection = open
            ? resolveWorkspaceItemTextSelection(open)
            : null;
          const nativePrompt = nativeAssistantTurnPrompt({
            context: tools.describeContext(submittedView),
            item:
              open && submittedView.postId
                ? {
                    id: submittedView.postId,
                    title: open.title,
                    excerpt: open.excerpt,
                    body: open.body,
                  }
                : null,
            request: preparedPrompt,
            relatedItems,
            selection: openSelection,
            workspaceIndex: open
              ? null
              : nativeWorkspaceIndex(getPoolRef.current()),
          });
          if (submitNativeAssistantTurn(nativePrompt)) {
            const currentPost =
              open && submittedView.postId && getPoolRef.current()
                ? findPoolPostById(getPoolRef.current()!, submittedView.postId)
                : null;
            const currentProof =
              currentPost && getPoolRef.current()
                ? itemArtifactProof({
                    id: currentPost.id,
                    operation: "Read",
                    pool: getPoolRef.current(),
                    title: open?.title,
                  })
                : null;
            nativeProofsRef.current = mergeArtifactProofs(
              currentProof
                ? [currentProof]
                : nativeIndexProofs(modelPrompt, getPoolRef.current()),
              loadedContextArtifactProofs(relatedItems, getPoolRef.current()),
            );
            appendToThread(
              thread,
              "progress",
              "Working with the TextText Agent",
            );
            nativeJobRef.current = jobId;
            nativeMessageRef.current = null;
            return;
          }
        }
        updateAssistantJob(jobId, { activity: "Contacting your AI provider" });
        // Hand over what the writer is looking at, the way the quick actions
        // already do. Without it a request about "this document" arrives as an
        // id with no text behind it.
        const open = submittedView.postId
          ? await readItemTextRef
              .current(submittedView.postId)
              .catch(() => null)
          : null;
        const openSelection = open
          ? resolveWorkspaceItemTextSelection(open)
          : null;
        const cloudAbortController = new AbortController();
        activeCloudAbortRef.current = cloudAbortController;
        let cloudMessageId: string | null = null;
        let streamProvider: CloudAssistantProviderLabel | undefined;
        let streamModel: string | undefined;
        const onCloudEvent = (event: CloudAssistantStreamEvent) => {
          if (event.type === "start") {
            streamProvider = event.provider;
            streamModel = event.model;
            setCloudProvider(event.provider);
            setThreadCloudProvider(thread, event.provider);
            updateAssistantJob(jobId, {
              activity: `Connected to ${event.provider}`,
            });
          } else if (event.type === "progress") {
            appendToThread(thread, "progress", event.message);
            updateAssistantJob(jobId, { activity: event.message });
          } else if (event.type === "text" && event.text) {
            if (!cloudMessageId) {
              cloudMessageId = appendToThread(
                thread,
                "assistant",
                event.text,
                undefined,
                streamProvider,
              );
              if (streamModel) {
                updateThreadMessage(thread, cloudMessageId, (message) => ({
                  ...message,
                  model: streamModel,
                }));
              }
            } else {
              updateThreadMessage(thread, cloudMessageId, (message) => ({
                ...message,
                text: `${message.text}${event.text}`,
              }));
            }
          }
        };
        const result = await cloudAssistantTurn(preparedPrompt, {
          level: submittedView.level,
          folderPath: submittedView.folderPath,
          postId: submittedView.postId,
          itemTitle: open?.title,
          selection: openSelection?.text,
          itemPreview: open?.body?.slice(0, 4000),
          relatedItems: relatedItems.map((item) => ({ id: item.id })),
          ...(cloudAttachments.length > 0
            ? { attachments: cloudAttachments }
            : {}),
        }, {
          stream: true,
          signal: cloudAbortController.signal,
          onEvent: onCloudEvent,
        });
        if ("disabled" in result) {
          const fallbackMessageId = appendToThread(
            thread,
            "error",
            "Connect Anthropic or OpenAI in Workspace Settings.",
          );
          updateAssistantJob(jobId, { status: "error" });
          return;
        }
        setCloudProvider(result.provider);
        setThreadCloudProvider(thread, result.provider);
        const pool = getPoolRef.current();
        let proofs = mergeArtifactProofs(
          cloudContextProofs(result.contextItems, pool),
          cloudWorkspaceProofs(result.workspaceCalls, pool),
        );
        if (open && submittedView.postId && pool) {
          const proof = itemArtifactProof({
            id: submittedView.postId,
            operation: "Read",
            pool,
            title: open?.title,
          });
          if (proof) proofs = mergeArtifactProofs([proof], proofs);
        }
        const finalText =
          result.text ||
          (result.terminalError
            ? "Some actions completed before the assistant stopped."
            : "Done.");
        if (cloudMessageId) {
          updateThreadMessage(thread, cloudMessageId, (message) => ({
            ...message,
            text: finalText,
            provider: result.provider,
            model: result.model,
            outbound:
              result.outboundCalls.length || result.unreachableServers.length
                ? {
                    calls: result.outboundCalls,
                    unreachable: result.unreachableServers,
                  }
                : undefined,
            artifactProofs: proofs.length > 0 ? proofs : message.artifactProofs,
          }));
        } else {
          const fallbackMessageId = appendToThread(
            thread,
            "assistant",
            finalText,
            undefined,
            result.provider,
            result.outboundCalls.length || result.unreachableServers.length
              ? {
                  calls: result.outboundCalls,
                  unreachable: result.unreachableServers,
                }
              : undefined,
            proofs.length > 0 ? proofs : undefined,
          );
          updateThreadMessage(thread, fallbackMessageId, (message) => ({
            ...message,
            model: result.model,
          }));
        }
        if (result.terminalError) {
          appendToThread(thread, "error", result.terminalError);
          updateAssistantJob(jobId, { status: "error" });
        } else {
          updateAssistantJob(jobId, { status: "done" });
        }
      } catch (error) {
        appendToThread(thread, "error", assistantAgentError(error));
        updateAssistantJob(jobId, { status: "error" });
      } finally {
        activeCloudAbortRef.current = null;
        setThreadCloudProvider(thread, null);
        setThreadBusy(thread, false);
      }
    },
    [contextKey, contextLabel, nativeConnection, threadKey, tools],
  );

  const runQuickAction = useCallback(
    async (action: NativeQuickActionId) => {
      const thread = threadKey;
      if (busyThreads.has(thread)) return;
      const view = getViewRef.current();
      if (!view.postId) return;
      const actionLabel =
        NATIVE_QUICK_ACTIONS.find((candidate) => candidate.id === action)
          ?.label ?? action;
      setThreadBusy(thread, true);
      let actionPrompt =
        action === "structure"
          ? "Restructure the current item's full body into a clear, useful document. Preserve its meaning and details. Return the complete replacement body only. Do not change the item."
          : `${actionLabel} the current item. Return the suggestion only. Do not change the item.`;
      try {
        const item = await readItemTextRef.current(view.postId);
        const selection = resolveWorkspaceItemTextSelection(item);
        const selectionAction = action === "rewrite" || action === "summarize";
        appendToThread(
          thread,
          "user",
          selection && selectionAction
            ? `${actionLabel} selection`
            : actionLabel,
        );
        if (selection && selectionAction) {
          actionPrompt = `${actionLabel} this selected ${selection.field} text. Return the suggestion only. Do not change the item.`;
        }
        const cloudAbortController = new AbortController();
        activeCloudAbortRef.current = cloudAbortController;
        const result = await cloudAssistantTurn(actionPrompt, {
          level: view.level,
          folderPath: view.folderPath,
          postId: view.postId,
          itemTitle: item.title,
          selection: selection?.text,
          itemPreview: item.body.slice(0, 4000),
          mode: "suggestion",
        }, {
          stream: true,
          signal: cloudAbortController.signal,
          onEvent: (event) => {
            if (event.type === "start") {
              setCloudProvider(event.provider);
              setThreadCloudProvider(thread, event.provider);
            } else if (event.type === "progress") {
              appendToThread(thread, "progress", event.message);
            }
          },
        });
        if ("disabled" in result) {
          appendToThread(
            thread,
            "error",
            "Connect Anthropic or OpenAI in Workspace Settings.",
          );
          return;
        }
        setCloudProvider(result.provider);
        setThreadCloudProvider(thread, result.provider);
        const pool = getPoolRef.current();
        let proofs = cloudWorkspaceProofs(result.workspaceCalls, pool);
        const proof = itemArtifactProof({
          id: view.postId,
          operation: "Read",
          pool,
          title: item.title,
        });
        if (proof) proofs = mergeArtifactProofs([proof], proofs);
        appendToThread(
          thread,
          "assistant",
          result.text || "Done.",
          result.terminalError
            ? undefined
            : quickActionProposal({
                action,
                actionLabel,
                item,
                itemId: view.postId,
                selection: selection && selectionAction ? selection : null,
                text: result.text ?? "",
              }),
          result.provider,
          result.outboundCalls.length || result.unreachableServers.length
            ? {
                calls: result.outboundCalls,
                unreachable: result.unreachableServers,
              }
            : undefined,
          proofs.length > 0 ? proofs : undefined,
        );
        if (result.terminalError) {
          appendToThread(thread, "error", result.terminalError);
        }
      } catch (error) {
        appendToThread(
          thread,
          "error",
          error instanceof Error && error.message
            ? error.message
            : "The AI provider could not finish.",
        );
      } finally {
        activeCloudAbortRef.current = null;
        setThreadCloudProvider(thread, null);
        setThreadBusy(thread, false);
      }
    },
    [threadKey],
  );

  const applyProposalValue = useCallback(
    async (messageId: string, direction: "apply" | "undo") => {
      const message = threadFor(threadKey).find(
        (candidate) => candidate.id === messageId,
      );
      const proposal = message?.proposal;
      if (!message || !proposal || !proposal.canApply) return;
      if (
        (direction === "apply" &&
          proposal.status !== "pending" &&
          proposal.status !== "undone") ||
        (direction === "undo" && proposal.status !== "applied")
      ) {
        return;
      }
      if (proposal.kind === "tags") {
        const current = await readItemTextRef.current(proposal.itemId);
        const expected =
          direction === "apply" ? proposal.beforeTags : proposal.afterTags;
        const next =
          direction === "apply" ? proposal.afterTags : proposal.beforeTags;
        if (
          JSON.stringify(normalizeTags(current.tags)) !==
          JSON.stringify(normalizeTags(expected))
        ) {
          appendToThread(
            threadKey,
            "error",
            "This item changed after the preview. Run the action again.",
          );
          return;
        }
        updateThreadMessage(threadKey, messageId, (candidate) => ({
          ...candidate,
          proposal: candidate.proposal
            ? {
                ...candidate.proposal,
                status: direction === "apply" ? "applying" : "undoing",
              }
            : undefined,
        }));
        try {
          const outcome = await tools.executor("update_item", {
            id: proposal.itemId,
            tags: normalizeTags(next),
          });
          const queued = workspaceMutationQueued(outcome);
          updateThreadMessage(threadKey, messageId, (candidate) => ({
            ...candidate,
            artifactProofs: queued
              ? candidate.artifactProofs
              : (() => {
                  const proof = itemArtifactProof({
                    id: proposal.itemId,
                    operation: "Updated",
                    pool: getPoolRef.current(),
                  });
                  return proof
                    ? mergeArtifactProofs(candidate.artifactProofs, [proof])
                    : candidate.artifactProofs;
                })(),
            proposal: candidate.proposal
              ? {
                  ...candidate.proposal,
                  status: direction === "apply" ? "applied" : "undone",
                  syncPending: queued,
                }
              : undefined,
          }));
        } catch (error) {
          updateThreadMessage(threadKey, messageId, (candidate) => ({
            ...candidate,
            proposal: candidate.proposal
              ? {
                  ...candidate.proposal,
                  status: direction === "apply" ? "pending" : "applied",
                }
              : undefined,
          }));
          appendToThread(
            threadKey,
            "error",
            error instanceof Error && error.message
              ? error.message
              : "The change could not be applied.",
          );
        }
        return;
      }
      const edit = proposalEdit(proposal);
      if (!edit) {
        appendToThread(
          threadKey,
          "error",
          "This preview is no longer valid. Run the action again.",
        );
        return;
      }
      const current = await readItemTextRef.current(proposal.itemId);
      const start = edit.range.start;
      const expectedText = direction === "apply" ? edit.before : edit.after;
      const replacementText = direction === "apply" ? edit.after : edit.before;
      const end = start + expectedText.length;
      if (current[edit.field].slice(start, end) !== expectedText) {
        appendToThread(
          threadKey,
          "error",
          "This item changed after the preview. Run the action again.",
        );
        return;
      }

      updateThreadMessage(threadKey, messageId, (candidate) => ({
        ...candidate,
        proposal: candidate.proposal
          ? {
              ...candidate.proposal,
              status: direction === "apply" ? "applying" : "undoing",
            }
          : undefined,
      }));
      try {
        const outcome = await tools.executor("update_item", {
          id: proposal.itemId,
          text_edit: {
            field: edit.field,
            start,
            end,
            expected_text: expectedText,
            replacement_text: replacementText,
          },
        });
        const queued = workspaceMutationQueued(outcome);
        updateThreadMessage(threadKey, messageId, (candidate) => ({
          ...candidate,
          artifactProofs: queued
            ? candidate.artifactProofs
            : (() => {
                const proof = itemArtifactProof({
                  id: proposal.itemId,
                  operation: "Updated",
                  pool: getPoolRef.current(),
                });
                return proof
                  ? mergeArtifactProofs(candidate.artifactProofs, [proof])
                  : candidate.artifactProofs;
              })(),
          proposal: candidate.proposal
            ? {
                ...candidate.proposal,
                status: direction === "apply" ? "applied" : "undone",
                syncPending: queued,
              }
            : undefined,
        }));
      } catch (error) {
        updateThreadMessage(threadKey, messageId, (candidate) => ({
          ...candidate,
          proposal: candidate.proposal
            ? {
                ...candidate.proposal,
                status: direction === "apply" ? "pending" : "applied",
              }
            : undefined,
        }));
        appendToThread(
          threadKey,
          "error",
          error instanceof Error && error.message
            ? error.message
            : "The change could not be applied.",
        );
      }
    },
    [threadKey, tools],
  );

  const applyProposal = useCallback(
    (messageId: string) => applyProposalValue(messageId, "apply"),
    [applyProposalValue],
  );
  const undoProposal = useCallback(
    (messageId: string) => applyProposalValue(messageId, "undo"),
    [applyProposalValue],
  );

  const saveAnswer = useCallback(
    async (messageId: string) => {
      if (savingAnswerId) return;
      const thread = threadFor(threadKey);
      const messageIndex = thread.findIndex((candidate) => candidate.id === messageId);
      const message = thread[messageIndex];
      if (!message || message.role !== "assistant" || !message.text.trim()) return;
      if (message.savedItem) return;
      const source = [...thread.slice(0, messageIndex)]
        .reverse()
        .find((candidate) => candidate.role === "user")?.text;
      const capture = [
        source ? `Prompt: ${source}` : "Prompt: Assistant answer",
        `Assistant: ${message.text.trim()}`,
        message.provider ? `Provider: ${message.provider}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      setSavingAnswerId(messageId);
      try {
        const output = await tools.executor("create_item", {
          capture,
          idempotency_key: `assistant-answer:${messageId}`,
        });
        const proofs = workspaceToolArtifactProofs({
          args: { capture },
          output,
          pool: getPoolRef.current(),
          tool: "create_item",
        });
        const result =
          output && typeof output === "object" && !Array.isArray(output)
            ? (output as Record<string, unknown>)
            : {};
        const itemId =
          proofs[0]?.itemId ??
          (typeof result.id === "string" ? result.id : "");
        if (!itemId) throw new Error("The answer was not saved to Notes.");
        const title =
          proofs[0]?.title ??
          (typeof result.title === "string" && result.title.trim()
            ? result.title.trim()
            : "Saved answer");
        updateThreadMessage(threadKey, messageId, (candidate) => ({
          ...candidate,
          savedItem: { id: itemId, title },
          artifactProofs: mergeArtifactProofs(candidate.artifactProofs, proofs),
        }));
      } catch (error) {
        appendToThread(
          threadKey,
          "error",
          error instanceof Error && error.message
            ? error.message
            : "The answer could not be saved to Notes.",
        );
      } finally {
        setSavingAnswerId(null);
      }
    },
    [savingAnswerId, threadKey, tools],
  );

  const rateAnswer = useCallback(
    async (messageId: string, rating: "up" | "down") => {
      const message = threadFor(threadKey).find(
        (candidate) => candidate.id === messageId,
      );
      if (!message || message.role !== "assistant") return;
      const previous = message.feedback;
      updateThreadMessage(threadKey, messageId, (candidate) => ({
        ...candidate,
        feedback: rating,
      }));
      try {
        await submitAssistantFeedback({
          messageId,
          provider: message.provider ?? "Codex",
          rating,
        });
      } catch {
        updateThreadMessage(threadKey, messageId, (candidate) => ({
          ...candidate,
          ...(previous ? { feedback: previous } : { feedback: undefined }),
        }));
      }
    },
    [threadKey],
  );

  const cancel = useCallback(() => {
    const cloudAbort = activeCloudAbortRef.current;
    cloudAbort?.abort();
    if (!cloudAbort && nativeConnection?.state === "ready" && nativeJobRef.current) {
      requestNativeAssistant("assistantCancel");
    }
  }, [nativeConnection?.state]);

  const quickActions =
    getView().postId && cloudProvider
      ? NATIVE_QUICK_ACTIONS.map((action) => ({
          ...action,
          description: `${action.label} with ${cloudProvider}`,
        }))
      : [];
  const nativeReady = nativeConnection?.state === "ready";
  const attachmentsAvailable = nativeReady || Boolean(cloudProvider);
  const attachmentAccept = nativeReady
    ? assistantAttachmentAccept({ ocr: true })
    : cloudProvider
      ? assistantAttachmentAccept({ vision: true })
      : "";
  const attachmentTitle = nativeReady
    ? "Add a text or image attachment"
    : "Add a text or image attachment";

  const jobs = useSyncExternalStore(
    subscribeAssistantJobs,
    assistantJobs,
    assistantJobs,
  );
  const runningJobs = useSyncExternalStore(
    subscribeAssistantJobs,
    runningAssistantJobCount,
    () => 0,
  );

  return {
    activeCloudProvider,
    startNewConversation: () => clearThread(threadKey),
    attachmentAccept,
    attachmentsAvailable,
    attachmentTitle,
    applyProposal,
    cloudProvider,
    cancel,
    nativeConnection,
    connectNativeAssistant: () => requestNativeAssistant("assistantConnect"),
    jobs,
    generateItemTypeBlueprint,
    messages,
    quickActions,
    runQuickAction,
    runningJobs,
    saveAnswer,
    rateAnswer,
    savingAnswerId,
    submit,
    submitting,
    undoProposal,
  };
}
