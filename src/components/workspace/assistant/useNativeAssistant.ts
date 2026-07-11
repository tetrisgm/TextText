"use client";

// The assistant's brain, layer 1 of the provider ladder: Apple's on-device
// foundation model through the Mac app's nativeAI bridge. Free, private,
// offline. The hook probes capabilities, registers the workspace tool
// executor (agent tool calls EXECUTE here in the page), routes submissions
// to the on-device agent, and keeps a small conversation transcript.
//
// When the bridge or model is unavailable (plain web, old macOS, Apple
// Intelligence off) the transcript explains the fallback path instead of
// failing silently. The BYO-cloud rung slots in here later: same submit
// entry point, different transport.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

let messageCounter = 0;
function nextMessageId(): string {
  messageCounter += 1;
  return `m${messageCounter}`;
}

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
  getPool,
  getView,
  confirmDestructive,
}: UseNativeAssistantOptions) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [capabilities, setCapabilities] =
    useState<NativeAICapabilities | null>(null);
  const getPoolRef = useRef(getPool);
  const getViewRef = useRef(getView);
  const confirmRef = useRef(confirmDestructive);

  useEffect(() => {
    getPoolRef.current = getPool;
    getViewRef.current = getView;
    confirmRef.current = confirmDestructive;
  }, [confirmDestructive, getPool, getView]);

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

  const append = useCallback((role: AssistantMessageRole, text: string) => {
    setMessages((current) => [...current, { id: nextMessageId(), role, text }]);
  }, []);

  const submit = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || submitting) return;
      append("user", prompt);
      setSubmitting(true);
      try {
        const current = await nativeAICapabilities();
        setCapabilities(current);
        if (!current.available) {
          append("assistant", unavailableExplanation(current));
          return;
        }
        const reply = await nativeAgent(prompt, {
          context: tools.describeContext(getViewRef.current()),
          onEvent: (event) => {
            if (event.type === "tool") {
              append(
                "progress",
                TOOL_PROGRESS_LABELS[event.name] ?? `Running ${event.name}`,
              );
            }
          },
        });
        append("assistant", reply.text || "Done.");
      } catch (error) {
        append(
          "error",
          error instanceof Error && error.message
            ? error.message
            : "The assistant could not finish that.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [append, submitting, tools],
  );

  return { capabilities, messages, submit, submitting };
}
