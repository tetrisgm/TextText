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
// When the bridge or model is unavailable (plain web, old macOS, Apple
// Intelligence off) the transcript explains why instead of silently routing
// workspace content to another provider.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  hasNativeAI,
  isNativeModelAssetError,
  nativeAgent,
  nativeAICapabilities,
  registerNativeAgentTools,
  type NativeAICapabilities,
} from "@/lib/ai/native";
import { createWorkspaceAgentTools } from "@/lib/ai/agent-tools";
import { cloudAssistantTurn } from "@/lib/ai/cloud-client";
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
) {
  const next = [
    ...threadFor(threadKey),
    { id: nextMessageId(), role, text, proposal },
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

// ---- Unavailability copy ----

function unavailableExplanation(
  capabilities: NativeAICapabilities | null,
): string {
  if (!hasNativeAI()) {
    return "The on-device assistant is available inside Write for Mac.";
  }
  switch (capabilities?.reason) {
    case "appleIntelligenceNotEnabled":
      return "Apple Intelligence is turned off. Enable it in System Settings, then try again.";
    case "modelNotReady":
      return "The on-device model is still downloading. Try again in a few minutes.";
    case "deviceNotEligible":
      return "This Mac does not support Apple Intelligence.";
    case "osTooOld":
      return "On-device AI needs macOS 26 or later.";
    default:
      return "On-device AI is unavailable right now.";
  }
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
      appendToThread(thread, "user", displayPrompt);
      setThreadBusy(thread, true);
      const jobId = startAssistantJob({
        threadKey: thread,
        contextKey,
        contextLabel: contextLabel(),
        prompt: displayPrompt,
      });
      try {
        const submittedView = getViewRef.current();
        const editingItem =
          submittedView.level === "edit" && submittedView.postId
            ? await readItemTextRef.current(submittedView.postId)
            : null;
        const current = await nativeAICapabilities();
        setCapabilities(current);
        if (!current.available) {
          // On-device is unavailable (plain web / ineligible device). Fall back
          // to the cloud assistant when the owner has enabled it; otherwise keep
          // the on-device explanation. Local-first: this only runs after the
          // on-device probe reports unavailable.
          const outcome = await cloudAssistantTurn(prompt, {
            level: submittedView.level,
            folderPath: submittedView.folderPath,
            postId: submittedView.postId,
          });
          if ("disabled" in outcome) {
            appendToThread(thread, "assistant", unavailableExplanation(current));
          } else {
            appendToThread(thread, "assistant", outcome.text || "Done.");
          }
          updateAssistantJob(jobId, { status: "done" });
          return;
        }
        const prepared = await buildNativeAssistantPrompt(prompt, attachments);
        const baseContext = tools.describeContext(submittedView);
        const context = editingItem
          ? appendAssistantSelectionContext(baseContext, editingItem)
          : baseContext;
        const { instructions } = composeInstructions(
          handle,
          prepared.prompt,
          context,
        );
        const reply = await nativeAgent(prepared.prompt, {
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
        appendToThread(thread, "assistant", reply.text || "Done.");
        updateAssistantJob(jobId, { status: "done" });
      } catch (error) {
        let message =
          error instanceof Error && error.message
            ? error.message
            : "The assistant could not finish that.";
        if (isNativeModelAssetError(error)) {
          const latest = await nativeAICapabilities();
          setCapabilities(latest);
          message = latest.available
            ? "The Assistant could not complete that request. Try again."
            : unavailableExplanation(latest);
        }
        appendToThread(
          thread,
          "error",
          message,
        );
        updateAssistantJob(jobId, { status: "error" });
      } finally {
        setThreadBusy(thread, false);
      }
    },
    [contextKey, contextLabel, handle, threadKey, tools],
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
        const current = await nativeAICapabilities();
        setCapabilities(current);
        if (!current.available) {
          appendToThread(thread, "assistant", unavailableExplanation(current));
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
        const result = await runNativeQuickAction(action, item);
        if (result.kind === "response") {
          appendToThread(thread, "assistant", result.text || "Done.");
          return;
        }
        if (result.kind === "tags-proposal") {
          appendToThread(thread, "assistant", result.label, {
            kind: "tags",
            itemId: view.postId,
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
          itemId: view.postId,
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
      } catch (error) {
        appendToThread(
          thread,
          "error",
          error instanceof Error && error.message
            ? error.message
            : "The on-device action could not finish.",
        );
      } finally {
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

  const textOps = capabilities?.textOps;
  const quickActions =
    getView().postId && capabilities?.available
      ? NATIVE_QUICK_ACTIONS.filter(
          (action) => !textOps || textOps.includes(action.id),
        )
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
    attachmentAccept: assistantAttachmentAccept(capabilities),
    attachmentsAvailable,
    attachmentTitle,
    applyProposal,
    capabilities,
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
