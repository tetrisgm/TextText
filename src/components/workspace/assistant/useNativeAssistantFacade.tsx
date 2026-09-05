"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  assistantBoundarySnapshot,
  loadAssistantBoundary,
  scheduleAssistantBoundaryLoad,
  subscribeAssistantBoundary,
} from "./assistant-boundary";
import type {
  UseNativeAssistantOptions,
  useNativeAssistant as useNativeAssistantImplementation,
} from "./useNativeAssistant";

type NativeAssistantResult = ReturnType<typeof useNativeAssistantImplementation>;
type NativeAssistantMethod = {
  [Key in keyof NativeAssistantResult]: NativeAssistantResult[Key] extends (
    ...args: never[]
  ) => unknown
    ? Key
    : never;
}[keyof NativeAssistantResult];

type QueuedCall = {
  args: unknown[];
  method: NativeAssistantMethod;
  reject?: (reason?: unknown) => void;
  resolve?: (value: unknown) => void;
};

type AssistantFacadeEntry = {
  callsReady: boolean;
  listeners: Set<() => void>;
  queue: QueuedCall[];
  result: NativeAssistantResult | null;
  settleTimer: ReturnType<typeof setTimeout> | null;
  wrappers: Partial<Record<NativeAssistantMethod, (...args: unknown[]) => unknown>>;
};

const entriesByOptions = new WeakMap<
  UseNativeAssistantOptions,
  AssistantFacadeEntry
>();

function notify(entry: AssistantFacadeEntry) {
  for (const listener of entry.listeners) listener();
}

function dispatchQueuedCalls(entry: AssistantFacadeEntry) {
  const result = entry.result;
  if (!result || entry.queue.length === 0) return;
  const queue = entry.queue.splice(0);
  for (const call of queue) {
    try {
      const method = result[call.method] as (...args: unknown[]) => unknown;
      const value = method(...call.args);
      if (call.resolve) Promise.resolve(value).then(call.resolve, call.reject);
    } catch (error) {
      call.reject?.(error);
    }
  }
}

function publishAssistantResult(
  entry: AssistantFacadeEntry,
  result: NativeAssistantResult,
) {
  entry.result = result;
  if (result.ownerScopeStatus !== "checking") {
    if (result.cloudProvider || result.nativeConnection) {
      if (entry.settleTimer) clearTimeout(entry.settleTimer);
      entry.settleTimer = null;
      entry.callsReady = true;
      dispatchQueuedCalls(entry);
    } else if (!entry.settleTimer) {
      // Owner scope resolves before the provider probes it unlocks. Give those
      // effects one bounded turn to publish so a first click cannot race a
      // configured connection and get handled as if no assistant existed.
      entry.settleTimer = setTimeout(() => {
        entry.settleTimer = null;
        entry.callsReady = true;
        dispatchQueuedCalls(entry);
      }, 1000);
    }
  }
  notify(entry);
}

function queuedMethod(
  entry: AssistantFacadeEntry,
  method: NativeAssistantMethod,
  asynchronous: boolean,
  fallback?: unknown,
) {
  const existing = entry.wrappers[method];
  if (existing) return existing;

  const wrapper = (...args: unknown[]) => {
    void loadAssistantBoundary();
    const current = entry.result;
    if (current && entry.callsReady) {
      const implementation = current[method] as (...values: unknown[]) => unknown;
      return implementation(...args);
    }
    if (!asynchronous) {
      entry.queue.push({ args, method });
      return fallback;
    }
    return new Promise((resolve, reject) => {
      entry.queue.push({ args, method, reject, resolve });
    });
  };
  entry.wrappers[method] = wrapper;
  return wrapper;
}

function inertResult(
  entry: AssistantFacadeEntry,
  contextKey: string,
): NativeAssistantResult {
  return {
    activeCloudProvider: null,
    activeConversationId: null,
    conversationContextKey: contextKey,
    conversationStoreKey: null,
    searchConversations: queuedMethod(entry, "searchConversations", false, []),
    startNewConversation: queuedMethod(entry, "startNewConversation", false, ""),
    openConversation: queuedMethod(entry, "openConversation", false, false),
    openConversationInContext: queuedMethod(
      entry,
      "openConversationInContext",
      false,
      false,
    ),
    toggleConversationPinned: queuedMethod(
      entry,
      "toggleConversationPinned",
      false,
      false,
    ),
    deleteConversation: queuedMethod(entry, "deleteConversation", false, false),
    attachmentAccept: "",
    attachmentsAvailable: false,
    attachmentTitle: "Add a text or image attachment",
    applyProposal: queuedMethod(entry, "applyProposal", true),
    cloudProvider: null,
    modelChoices: [],
    selectedCloudModel: null,
    selectCloudModel: queuedMethod(entry, "selectCloudModel", false),
    decideWriteProposal: queuedMethod(entry, "decideWriteProposal", true),
    cancel: queuedMethod(entry, "cancel", false),
    nativeConnection: null,
    connectNativeAssistant: queuedMethod(
      entry,
      "connectNativeAssistant",
      false,
    ),
    jobs: [],
    generateItemTypeBlueprint: queuedMethod(
      entry,
      "generateItemTypeBlueprint",
      true,
    ),
    ownerScopeReady: false,
    ownerScopeStatus: "checking",
    quickActions: [],
    runQuickAction: queuedMethod(entry, "runQuickAction", true),
    createSelectionPreview: queuedMethod(entry, "createSelectionPreview", true),
    runningJobs: 0,
    saveAnswer: queuedMethod(entry, "saveAnswer", true),
    rateAnswer: queuedMethod(entry, "rateAnswer", true),
    savingAnswerId: null,
    submit: queuedMethod(entry, "submit", true),
    submitting: false,
    undoProposal: queuedMethod(entry, "undoProposal", true),
  } as NativeAssistantResult;
}

function createEntry(): AssistantFacadeEntry {
  return {
    callsReady: false,
    listeners: new Set<() => void>(),
    queue: [],
    result: null,
    settleTimer: null,
    wrappers: {},
  };
}

export function useNativeAssistant(options: UseNativeAssistantOptions) {
  const [entry] = useState(createEntry);
  const fallback = useMemo(
    () => inertResult(entry, options.contextKey),
    [entry, options.contextKey],
  );
  entriesByOptions.set(options, entry);

  const subscribe = useCallback(
    (listener: () => void) => {
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    [entry],
  );
  const result = useSyncExternalStore(
    subscribe,
    () => entry.result ?? fallback,
    () => fallback,
  );

  useEffect(() => scheduleAssistantBoundaryLoad(), []);
  useEffect(
    () => () => {
      for (const call of entry.queue.splice(0)) call.resolve?.(undefined);
      if (entry.settleTimer) clearTimeout(entry.settleTimer);
      entry.settleTimer = null;
      entry.result = null;
      entry.listeners.clear();
    },
    [entry],
  );
  return result;
}

export const NativeAssistantRuntime = memo(function NativeAssistantRuntime({
  options,
}: {
  options: UseNativeAssistantOptions;
}) {
  const modules = useSyncExternalStore(
    subscribeAssistantBoundary,
    assistantBoundarySnapshot,
    () => null,
  );
  const entry = entriesByOptions.get(options);
  const onResult = useCallback(
    (result: NativeAssistantResult) => {
      if (entry) publishAssistantResult(entry, result);
    },
    [entry],
  );
  if (!modules || !entry) return null;
  return (
    <modules.controller.NativeAssistantRuntime
      onResult={onResult}
      options={options}
    />
  );
});

export function conversationIdFromThreadKey(threadKey: string): string | null {
  const separator = threadKey.indexOf("\u001f");
  const conversationId =
    separator < 0 ? threadKey : threadKey.slice(separator + 1);
  return conversationId && conversationId !== "server" ? conversationId : null;
}

export type { AssistantMessage, AssistantViewSnapshot } from "./useNativeAssistant";
