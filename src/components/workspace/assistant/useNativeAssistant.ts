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
  nativeAgent,
  nativeAICapabilities,
  registerNativeAgentTools,
  type NativeAICapabilities,
} from "@/lib/ai/native";
import { createWorkspaceAgentTools } from "@/lib/ai/agent-tools";
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
import type { AssistantAttachment } from "./AssistantSidebar";
import {
  buildNativeAssistantPrompt,
  formatAssistantSubmission,
} from "./attachments";
import type { AssistantViewSnapshot } from "./context";

export type { AssistantViewSnapshot } from "./context";

export type AssistantMessageRole = "user" | "assistant" | "progress" | "error";

export type AssistantMessage = {
  id: string;
  role: AssistantMessageRole;
  text: string;
};

type UseNativeAssistantOptions = {
  handle: string;
  contextKey: string;
  getPool: () => WorkspacePoolPayload | null;
  getView: () => AssistantViewSnapshot;
  confirmDestructive?: (description: string) => Promise<boolean> | boolean;
};

const TOOL_PROGRESS_LABELS: Record<string, string> = {
  list_folders: "Looking at your folders",
  list_items: "Listing items",
  read_item: "Reading an item",
  create_item: "Creating an item",
  update_item: "Updating an item",
  append_to_item: "Appending to an item",
  move_item: "Moving an item",
  delete_item: "Deleting an item",
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
) {
  const next = [
    ...threadFor(threadKey),
    { id: nextMessageId(), role, text },
  ].slice(-MAX_MESSAGES_PER_THREAD);
  transcripts.set(threadKey, next);
  try {
    sessionStorage.setItem(storageKey(threadKey), JSON.stringify(next));
  } catch {
    // Quota or private mode: the in-memory thread still works.
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
  confirmDestructive,
}: UseNativeAssistantOptions) {
  const [capabilities, setCapabilities] =
    useState<NativeAICapabilities | null>(null);
  const getPoolRef = useRef(getPool);
  const getViewRef = useRef(getView);
  const threadKey = `${handle}:${contextKey}`;

  useEffect(() => {
    getPoolRef.current = getPool;
    getViewRef.current = getView;
  }, [getPool, getView]);

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
        confirmDestructive: (description) =>
          confirmDestructive ? confirmDestructive(description) : false,
      }),
    [confirmDestructive, getPool, handle],
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
        const current = await nativeAICapabilities();
        setCapabilities(current);
        if (!current.available) {
          appendToThread(thread, "assistant", unavailableExplanation(current));
          updateAssistantJob(jobId, { status: "done" });
          return;
        }
        const prepared = await buildNativeAssistantPrompt(prompt, attachments);
        const context = tools.describeContext(getViewRef.current());
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
        appendToThread(
          thread,
          "error",
          error instanceof Error && error.message
            ? error.message
            : "The assistant could not finish that.",
        );
        updateAssistantJob(jobId, { status: "error" });
      } finally {
        setThreadBusy(thread, false);
      }
    },
    [contextKey, contextLabel, handle, threadKey, tools],
  );

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
    capabilities,
    deleteSkill,
    jobs,
    messages,
    runningJobs,
    skills,
    submit,
    submitting,
    toggleSkill,
  };
}
