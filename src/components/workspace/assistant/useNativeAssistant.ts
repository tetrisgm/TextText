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
  resolveWorkspaceItemTextEdit,
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
  installSkill,
  removeSkill,
  setSkillEnabled,
  skillStates,
} from "@/lib/ai/skills";
import { findPoolPostById } from "@/lib/pool/selectors";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";
import { normalizeTags } from "@/lib/tags";
import type { AssistantAttachment } from "./AssistantSidebar";
import { formatAssistantSubmission } from "./attachments";
import { type AssistantViewSnapshot } from "./context";
import {
  nativeAssistantAvailable,
  requestNativeAssistant,
  subscribeNativeAssistant,
  submitNativeAssistantTurn,
} from "@/lib/ai/native-client";
import type { AiConnectionSnapshot } from "@/lib/ai/connection-state";

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
  proposal?: AssistantProposal;
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
  ) => Promise<unknown> | unknown;
  confirmDestructive?: (description: string) => Promise<boolean> | boolean;
};


function assistantAgentError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
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
) {
  const next = [
    ...threadFor(threadKey),
    { id: nextMessageId(), role, text, proposal, provider },
  ].slice(-MAX_MESSAGES_PER_THREAD);
  transcripts.set(threadKey, next);
  try {
    sessionStorage.setItem(storageKey(threadKey), JSON.stringify(next));
  } catch {
    // Quota or private mode: the in-memory thread still works.
  }
  notify();
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
    () => threadFor(threadKey),
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


  useEffect(() => {
    const unsubscribe = subscribeNativeAssistant((event) => {
      if (event.type === "status") {
        setNativeConnection((current) => ({
          state: event.state ?? current?.state ?? "unavailable",
          kind: event.kind ?? current?.kind ?? "native-codex",
          providerLabel: event.providerLabel ?? current?.providerLabel ?? "Codex with ChatGPT",
          accountEmail: event.accountEmail ?? current?.accountEmail ?? null,
          planLabel: event.planLabel ?? current?.planLabel ?? null,
          runtimeVersion: event.runtimeVersion ?? current?.runtimeVersion ?? null,
          rateLimitResetAt: event.rateLimitResetAt ?? current?.rateLimitResetAt ?? null,
          lastHealthCheckAt: event.lastHealthCheckAt ?? current?.lastHealthCheckAt ?? null,
          embeddedChatSupported: event.embeddedChatSupported ?? current?.embeddedChatSupported ?? false,
          recoveryAction: event.recoveryAction ?? current?.recoveryAction ?? null,
        }));
      } else if (event.type === "text-delta") {
        appendToThread(threadKey, "assistant", event.text, undefined, "OpenAI");
      }
    });
    if (nativeAssistantAvailable()) requestNativeAssistant("assistantStatus");
    return unsubscribe;
  }, []);

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
        if (nativeConnection?.state === "ready" && submitNativeAssistantTurn(prompt)) {
          appendToThread(thread, "progress", "Working with the TextText Agent");
          return;
        }
        updateAssistantJob(jobId, { activity: "Contacting your AI provider" });
        // Hand over what the writer is looking at, the way the quick actions
        // already do. Without it a request about "this document" arrives as an
        // id with no text behind it.
        const open = submittedView.postId
          ? await readItemTextRef.current(submittedView.postId).catch(() => null)
          : null;
        const openSelection = open
          ? resolveWorkspaceItemTextSelection(open)
          : null;
        const result = await cloudAssistantTurn(prompt, {
          level: submittedView.level,
          folderPath: submittedView.folderPath,
          postId: submittedView.postId,
          itemTitle: open?.title,
          selection: openSelection?.text,
          itemPreview: open?.body?.slice(0, 4000),
        });
        if ("disabled" in result) {
          appendToThread(
            thread,
            "error",
            "Connect Anthropic or OpenAI in Workspace Settings.",
          );
          updateAssistantJob(jobId, { status: "error" });
          return;
        }
        setCloudProvider(result.provider);
        setThreadCloudProvider(thread, result.provider);
        appendToThread(
          thread,
          "assistant",
          result.text || "Done.",
          undefined,
          result.provider,
        );
        updateAssistantJob(jobId, { status: "done" });
      } catch (error) {
        appendToThread(thread, "error", assistantAgentError(error));
        updateAssistantJob(jobId, { status: "error" });
      } finally {
        setThreadCloudProvider(thread, null);
        setThreadBusy(thread, false);
      }
    },
    [
      contextKey,
      contextLabel,
      nativeConnection,
      threadKey,
    ],
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
      let actionPrompt = `${actionLabel} the current item. Return the suggestion only. Do not change the item.`;
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
          actionPrompt = `${actionLabel} this selected ${selection.field} text. Return the suggestion only. Do not change the item.\n\n${selection.text}`;
        }
        const result = await cloudAssistantTurn(actionPrompt, {
          level: view.level,
          folderPath: view.folderPath,
          postId: view.postId,
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
        appendToThread(
          thread,
          "assistant",
          result.text || "Done.",
          quickActionProposal({
            action,
            actionLabel,
            item,
            itemId: view.postId,
            selection: selection && selectionAction ? selection : null,
            text: result.text ?? "",
          }),
          result.provider,
        );
      } catch (error) {
        appendToThread(
          thread,
          "error",
          error instanceof Error && error.message
            ? error.message
            : "The AI provider could not finish.",
        );
      } finally {
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
          await tools.executor("update_item", {
            id: proposal.itemId,
            tags: normalizeTags(next),
          });
          updateThreadMessage(threadKey, messageId, (candidate) => ({
            ...candidate,
            proposal: candidate.proposal
              ? {
                  ...candidate.proposal,
                  status: direction === "apply" ? "applied" : "undone",
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
      const resolution = resolveWorkspaceItemTextEdit(current, edit, direction);
      if (!resolution.ok) {
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
        const result = await applyItemPatchRef.current(
          proposal.itemId,
          resolution.patch,
          resolution.expected,
        );
        const syncPending =
          typeof result === "object" &&
          result !== null &&
          "synced" in result &&
          (result as { synced?: unknown }).synced === false;
        updateThreadMessage(threadKey, messageId, (candidate) => ({
          ...candidate,
          proposal: candidate.proposal
            ? {
                ...candidate.proposal,
                status: direction === "apply" ? "applied" : "undone",
                syncPending,
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

  const quickActions =
    getView().postId && cloudProvider
      ? NATIVE_QUICK_ACTIONS.map((action) => ({
          ...action,
          description: `${action.label} with ${cloudProvider}`,
        }))
      : [];
  const attachmentsAvailable = false;
  const attachmentTitle =
    "Attachments are not available for provider connections yet";

  // Skill toggles for the sidebar; a plain version counter re-reads
  // localStorage-backed state after each change.
  const [skillsVersion, setSkillsVersion] = useState(0);
  const skills = useMemo(
    () => skillStates(handle),
    // skillsVersion invalidates the memo after a toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handle, skillsVersion],
  );
  const toggleSkill = useCallback(
    (skillId: string, enabled: boolean) => {
      setSkillEnabled(handle, skillId, enabled);
      setSkillsVersion((current) => current + 1);
    },
    [handle],
  );
  const addSkill = useCallback(
    async (reference: string) => {
      const skill = await installSkill(handle, reference);
      setSkillsVersion((current) => current + 1);
      return skill;
    },
    [handle],
  );
  const deleteSkill = useCallback(
    (skillId: string) => {
      removeSkill(handle, skillId);
      setSkillsVersion((current) => current + 1);
    },
    [handle],
  );

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
    addSkill,
    activeCloudProvider,
    startNewConversation: () => clearThread(threadKey),
    attachmentAccept: "",
    attachmentsAvailable,
    attachmentTitle,
    applyProposal,
    cloudProvider,
    nativeConnection,
    connectNativeAssistant: () => requestNativeAssistant("assistantConnect"),
    deleteSkill,
    jobs,
    messages,
    quickActions,
    runQuickAction,
    runningJobs,
    skills,
    submit,
    submitting,
    toggleSkill,
    undoProposal,
  };
}
