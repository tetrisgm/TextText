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
// Intelligence off) the transcript explains the fallback path instead of
// failing silently. The BYO-cloud rung slots in here later: same submit
// entry point, different transport.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  hasNativeAI,
  nativeAgent,
  nativeAICapabilities,
  registerNativeAgentTools,
  type NativeAICapabilities,
} from "@/lib/ai/native";
import { createWorkspaceAgentTools } from "@/lib/ai/agent-tools";
import type { WorkspacePoolPayload } from "@/lib/pool/types";

export type AssistantMessageRole = "user" | "assistant" | "progress" | "error";

export type AssistantMessage = {
  id: string;
  role: AssistantMessageRole;
  text: string;
};

export type AssistantViewSnapshot = {
  level?: string;
  folderPath?: string;
  postId?: string;
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
    return "The on-device assistant runs inside the Write app for Mac. Download it from the download page, or connect your own AI from Connect.";
  }
  switch (capabilities?.reason) {
    case "appleIntelligenceNotEnabled":
      return "Apple Intelligence is turned off. Enable it in System Settings, then try again.";
    case "modelNotReady":
      return "The on-device model is still downloading. Try again in a few minutes.";
    case "deviceNotEligible":
      return "This Mac does not support Apple Intelligence. Connect your own AI from Connect instead.";
    case "osTooOld":
      return "On-device AI needs macOS 26 or later. Connect your own AI from Connect instead.";
    default:
      return "On-device AI is unavailable right now. Connect your own AI from Connect instead.";
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
  const confirmRef = useRef(confirmDestructive);
  const threadKey = `${handle}:${contextKey}`;

  useEffect(() => {
    getPoolRef.current = getPool;
    getViewRef.current = getView;
    confirmRef.current = confirmDestructive;
  }, [confirmDestructive, getPool, getView]);

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
        getPool: () => getPoolRef.current(),
        confirmDestructive: (description) =>
          confirmRef.current
            ? confirmRef.current(description)
            : window.confirm(description),
      }),
    [handle],
  );

  useEffect(() => registerNativeAgentTools(tools.executor), [tools]);

  useEffect(() => {
    let cancelled = false;
    void nativeAICapabilities().then((result) => {
      if (!cancelled) setCapabilities(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      // One request per thread at a time; replies land in the thread that
      // asked, even if the user navigates away while the model works.
      const thread = threadKey;
      if (!prompt || busyThreads.has(thread)) return;
      appendToThread(thread, "user", prompt);
      setThreadBusy(thread, true);
      try {
        const current = await nativeAICapabilities();
        setCapabilities(current);
        if (!current.available) {
          appendToThread(thread, "assistant", unavailableExplanation(current));
          return;
        }
        const reply = await nativeAgent(prompt, {
          context: tools.describeContext(getViewRef.current()),
          onEvent: (event) => {
            if (event.type === "tool") {
              appendToThread(
                thread,
                "progress",
                TOOL_PROGRESS_LABELS[event.name] ?? `Running ${event.name}`,
              );
            }
          },
        });
        appendToThread(thread, "assistant", reply.text || "Done.");
      } catch (error) {
        appendToThread(
          thread,
          "error",
          error instanceof Error && error.message
            ? error.message
            : "The assistant could not finish that.",
        );
      } finally {
        setThreadBusy(thread, false);
      }
    },
    [threadKey, tools],
  );

  return { capabilities, messages, submit, submitting };
}
