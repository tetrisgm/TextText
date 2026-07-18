"use client";

// The assistant's brain, layer 1 of the provider ladder: Apple's on-device
// foundation model through the Mac app's nativeAI bridge. Free, private,
// offline. The hook probes capabilities, registers the workspace tool
// executor (agent tool calls EXECUTE here in the page), routes submissions
// to the on-device agent, and keeps one transcript PER CONTEXT: the root,
// each folder, and each item own their own thread, keyed by contextKey.
//
// Transcripts live in a module store mirrored to sessionStorage, so they
// survive component remounts, route changes (the full editor is a different
// route), and pool refreshes. A reply always lands in the thread that
// SUBMITTED it, even if the user navigates elsewhere while the model works.
//
// When the bridge or model is unavailable, the hook uses the owner's explicit
// cloud setting when present and otherwise explains the local state calmly.
// Every cloud reply is marked as off-device in the transcript.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  nativeAgent,
  nativeAICapabilities,
  registerNativeAgentTools,
  type NativeAICapabilities,
} from "@/lib/ai/native";
import { createWorkspaceAgentTools } from "@/lib/ai/agent-tools";
import {
  cloudAssistantStatus,
  type CloudAssistantProviderLabel,
} from "@/lib/ai/cloud-client";
import {
  NATIVE_QUICK_ACTIONS,
  runNativeQuickAction,
  type NativeQuickActionField,
  type NativeQuickActionId,
  type NativeQuickActionScope,
} from "@/lib/ai/quick-actions";
import {
  createWorkspaceItemTextEdit,
  resolveWorkspaceItemTextEdit,
  resolveWorkspaceItemTextSelection,
  type WorkspaceItemTextEdit,
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
  composeInstructions,
  installSkill,
  removeSkill,
  setSkillEnabled,
  skillStates,
} from "@/lib/ai/skills";
import { findPoolPostById } from "@/lib/pool/selectors";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import { normalizeTags } from "@/lib/tags";
import type { AssistantAttachment } from "./AssistantSidebar";
import {
  assistantAttachmentAccept,
  buildNativeAssistantPrompt,
  formatAssistantSubmission,
} from "./attachments";
import {
  appendAssistantSelectionContext,
  type AssistantViewSnapshot,
} from "./context";
import {
  fallbackForNativeAssetError,
  runUnavailableAssistantFallback,
} from "./unavailable-fallback";

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
  readItemText: (postId: string) => Promise<WorkspaceItemTextSnapshot>;
  applyItemPatch: (
    postId: string,
    patch: WorkspaceItemTextPatch,
    expected?: WorkspaceItemTextPatch,
  ) => Promise<unknown> | unknown;
  confirmDestructive?: (description: string) => Promise<boolean> | boolean;
};

const TOOL_PROGRESS_LABELS: Record<string, string> = {
  get_workspace: "Checking workspace access",
  list_folders: "Looking at your folders",
  create_folder: "Creating a folder",
  rename_folder: "Renaming a folder",
  list_items: "Listing items",
  list_trash: "Looking in Trash",
  read_item: "Reading an item",
  search: "Searching your workspace",
  create_item: "Creating an item",
  update_item: "Updating an item",
  append_to_item: "Appending to an item",
  move_item: "Moving an item",
  delete_item: "Moving an item to Trash",
  restore_item: "Restoring an item",
  set_item_status: "Changing publish status",
};

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
  return `write:assistant:${threadKey}`;
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

type NativeQuickActionResult = Awaited<
  ReturnType<typeof runNativeQuickAction>
>;

function appendQuickActionResult(
  thread: string,
  postId: string,
  result: NativeQuickActionResult,
) {
  if (result.kind === "response") {
    appendToThread(thread, "assistant", result.text || "Done.");
    return;
  }
  if (result.kind === "tags-proposal") {
    appendToThread(thread, "assistant", result.label, {
      kind: "tags",
      itemId: postId,
      label: result.label,
      beforeTags: result.beforeTags,
      afterTags: result.afterTags,
      addedTags: result.addedTags,
      canApply: result.canApply,
      note: result.note,
      status: "pending",
    });
    return;
  }
  appendToThread(thread, "assistant", result.label, {
    kind: "text",
    itemId: postId,
    field: result.field,
    label: result.label,
    before: result.before,
    after: result.after,
    source: result.source,
    result: result.result,
    range: result.range,
    scope: result.scope,
    canApply: result.canApply,
    note: result.note,
    status: "pending",
  });
}

export function useNativeAssistant({
  handle,
  contextKey,
  getPool,
  getView,
  readItemText,
  applyItemPatch,
  confirmDestructive,
}: UseNativeAssistantOptions) {
  const [capabilities, setCapabilities] =
    useState<NativeAICapabilities | null>(null);
  const [cloudProvider, setCloudProvider] =
    useState<CloudAssistantProviderLabel | null>(null);
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
        readItemText,
        applyItemPatch,
        confirmDestructive: (description) =>
          confirmDestructive ? confirmDestructive(description) : false,
      }),
    [applyItemPatch, confirmDestructive, getPool, handle, readItemText],
  );

  // Registration is deliberately sticky (no unregister on unmount): a job
  // started here must keep executing its tool calls while the user is on the
  // full-editor route, where this shell is unmounted. The pool store and the
  // executor's refs are module-lived, and the next mount re-registers.
  useEffect(() => {
    registerNativeAgentTools(tools.executor);
  }, [tools]);

  useEffect(() => {
    let cancelled = false;
    void nativeAICapabilities().then((result) => {
      if (!cancelled) setCapabilities(result);
    });
    return () => {
      cancelled = true;
    };
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

  const runGracefulFallback = useCallback(
    async ({
      capabilities: current,
      jobId,
      prompt,
      thread,
      view,
    }: {
      capabilities?: NativeAICapabilities;
      jobId?: string;
      prompt: string;
      thread: string;
      view: AssistantViewSnapshot;
    }): Promise<void> => {
      const context = {
        level: view.level,
        folderPath: view.folderPath,
        postId: view.postId,
      };
      const onCloudStart = (provider: CloudAssistantProviderLabel) => {
        setCloudProvider(provider);
        setThreadCloudProvider(thread, provider);
        if (jobId) {
          updateAssistantJob(jobId, {
            activity: `Thinking with ${provider}`,
          });
        }
      };
      const message = await runUnavailableAssistantFallback({
        capabilities: current ?? null,
        context,
        onCloudStart,
        prompt,
      });
      appendToThread(
        thread,
        message.role,
        message.text,
        undefined,
        message.provider,
      );
    },
    [],
  );

  const recoverNativeAssetFailure = useCallback(
    async <T,>({
      error,
      jobId,
      prompt,
      retryNative,
      thread,
      view,
    }: {
      error: unknown;
      jobId?: string;
      prompt: string;
      retryNative: () => Promise<T>;
      thread: string;
      view: AssistantViewSnapshot;
    }) => {
      let preparationAnnounced = false;
      const result = await fallbackForNativeAssetError({
        context: {
          level: view.level,
          folderPath: view.folderPath,
          postId: view.postId,
        },
        error,
        onCloudStart: (provider) => {
          setCloudProvider(provider);
          setThreadCloudProvider(thread, provider);
          if (jobId) {
            updateAssistantJob(jobId, {
              activity: `Thinking with ${provider}`,
            });
          }
        },
        onPreparing: (state, attempt, maximumAttempts) => {
          const activity =
            state === "downloading"
              ? "Downloading the on-device model"
              : "Preparing the on-device model";
          if (!preparationAnnounced) {
            preparationAnnounced = true;
            appendToThread(thread, "progress", activity);
          }
          if (jobId) {
            updateAssistantJob(jobId, {
              activity: `${activity} (${attempt} of ${maximumAttempts})`,
            });
          }
        },
        prompt,
        reprobe: nativeAICapabilities,
        retryNative,
      });
      if (!result) return null;
      setCapabilities(result.capabilities);
      if (result.kind === "fallback") {
        appendToThread(
          thread,
          result.message.role,
          result.message.text,
          undefined,
          result.message.provider,
        );
      }
      return result;
    },
    [],
  );

  const submit = useCallback(
    async (
      text: string,
      attachments: readonly AssistantAttachment[] = [],
    ) => {
      const prompt = text.trim();
      // One request per thread at a time; different threads run in parallel.
      // Replies and job updates land in the thread that asked, even if the
      // user navigates away while the model works.
      const thread = threadKey;
      if (
        (!prompt && attachments.length === 0) ||
        busyThreads.has(thread)
      ) {
        return;
      }
      const displayPrompt = formatAssistantSubmission(prompt, attachments);
      const submittedView = getViewRef.current();
      let fallbackPrompt = prompt;
      let retryNativeAgent:
        | (() => ReturnType<typeof nativeAgent>)
        | null = null;
      appendToThread(thread, "user", displayPrompt);
      setThreadBusy(thread, true);
      const jobId = startAssistantJob({
        threadKey: thread,
        contextKey,
        contextLabel: contextLabel(),
        prompt: displayPrompt,
      });
      try {
        const editingItem =
          submittedView.level === "edit" && submittedView.postId
            ? await readItemTextRef.current(submittedView.postId)
            : null;
        const current = await nativeAICapabilities();
        setCapabilities(current);
        if (!current.available) {
          await runGracefulFallback({
            capabilities: current,
            jobId,
            prompt: fallbackPrompt,
            thread,
            view: submittedView,
          });
          updateAssistantJob(jobId, { status: "done" });
          return;
        }
        const prepared = await buildNativeAssistantPrompt(prompt, attachments);
        fallbackPrompt = prepared.prompt;
        const baseContext = tools.describeContext(submittedView);
        const context = editingItem
          ? appendAssistantSelectionContext(baseContext, editingItem)
          : baseContext;
        const { instructions } = composeInstructions(
          handle,
          prepared.prompt,
          context,
        );
        retryNativeAgent = () =>
          nativeAgent(prepared.prompt, {
            context,
            instructions,
            tools: tools.toolNames,
            onEvent: (event) => {
              if (event.type === "tool") {
                const activity =
                  TOOL_PROGRESS_LABELS[event.name] ?? `Running ${event.name}`;
                appendToThread(thread, "progress", activity);
                updateAssistantJob(jobId, { activity });
              }
            },
          });
        const reply = await retryNativeAgent();
        appendToThread(thread, "assistant", reply.text || "Done.");
        updateAssistantJob(jobId, { status: "done" });
      } catch (error) {
        const recovery = retryNativeAgent
          ? await recoverNativeAssetFailure({
              error,
              jobId,
              prompt: fallbackPrompt,
              retryNative: retryNativeAgent,
              thread,
              view: submittedView,
            })
          : null;
        if (recovery) {
          if (recovery.kind === "recovered") {
            appendToThread(
              thread,
              "assistant",
              recovery.value.text || "Done.",
            );
          }
          updateAssistantJob(jobId, { status: "done" });
          return;
        }
        appendToThread(
          thread,
          "error",
          error instanceof Error && error.message
            ? error.message
            : "The assistant could not finish that.",
        );
        updateAssistantJob(jobId, { status: "error" });
      } finally {
        setThreadCloudProvider(thread, null);
        setThreadBusy(thread, false);
      }
    },
    [
      contextKey,
      contextLabel,
      handle,
      recoverNativeAssetFailure,
      runGracefulFallback,
      threadKey,
      tools,
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
      let fallbackPrompt = `${actionLabel} the current item. Return the suggestion only. Do not change the item.`;
      let retryNativeAction:
        | (() => ReturnType<typeof runNativeQuickAction>)
        | null = null;
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
          fallbackPrompt = `${actionLabel} this selected ${selection.field} text. Return the suggestion only. Do not change the item.\n\n${selection.text}`;
        }
        const current = await nativeAICapabilities();
        setCapabilities(current);
        if (!current.available) {
          await runGracefulFallback({
            capabilities: current,
            prompt: fallbackPrompt,
            thread,
            view,
          });
          return;
        }
        if (current.textOps && !current.textOps.includes(action)) {
          appendToThread(
            thread,
            "error",
            `${actionLabel} is not available on this Mac.`,
          );
          return;
        }
        retryNativeAction = () => runNativeQuickAction(action, item);
        const result = await retryNativeAction();
        appendQuickActionResult(thread, view.postId, result);
      } catch (error) {
        const recovery = retryNativeAction
          ? await recoverNativeAssetFailure({
              error,
              prompt: fallbackPrompt,
              retryNative: retryNativeAction,
              thread,
              view,
            })
          : null;
        if (recovery) {
          if (recovery.kind === "recovered") {
            appendQuickActionResult(thread, view.postId, recovery.value);
          }
          return;
        }
        appendToThread(
          thread,
          "error",
          error instanceof Error && error.message
            ? error.message
            : "The on-device action could not finish.",
        );
      } finally {
        setThreadCloudProvider(thread, null);
        setThreadBusy(thread, false);
      }
    },
    [recoverNativeAssetFailure, runGracefulFallback, threadKey],
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

  const textOps = capabilities?.textOps;
  const quickActions =
    getView().postId && (capabilities?.available || cloudProvider)
      ? capabilities?.available
        ? NATIVE_QUICK_ACTIONS.filter(
            (action) => !textOps || textOps.includes(action.id),
          )
        : NATIVE_QUICK_ACTIONS.map((action) => ({
            ...action,
            description: `${action.label} with ${cloudProvider} off this Mac`,
          }))
      : [];
  const attachmentsAvailable = capabilities?.available === true;
  const attachmentTitle = attachmentsAvailable
    ? capabilities.ocr
      ? "Add a text file or image for private on-device processing"
      : "Add a text file for private on-device processing"
    : capabilities
      ? "Attachments require the on-device assistant"
      : "Checking on-device attachment support";

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
    attachmentAccept: assistantAttachmentAccept(capabilities),
    attachmentsAvailable,
    attachmentTitle,
    applyProposal,
    capabilities,
    cloudProvider,
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
