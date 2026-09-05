"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { syncAssistantConversationsAction } from "@/app/editor/assistant-conversation-actions";
import {
  assistantConversationMessages,
  assistantConversationRevision,
  assistantConversationSummaries,
  pendingAssistantConversationSummaries,
  pendingAssistantProposalCount,
  serverAssistantConversationRevision,
  subscribeAssistantConversations,
  type AssistantConversationSummary,
  type AssistantPendingConversationSummary,
} from "./conversation-store";
import type { AssistantMessage } from "./useNativeAssistant";

import {
  startAssistantConversationSync,
  type AssistantHistorySyncStatus,
} from "./conversation-sync";

const EMPTY_MESSAGES: AssistantMessage[] = [];
const EMPTY_CONVERSATIONS: AssistantConversationSummary[] = [];
const EMPTY_PENDING_CONVERSATIONS: AssistantPendingConversationSummary[] = [];

export type AssistantConversationView = {
  conversations: AssistantConversationSummary[];
  messages: AssistantMessage[];
  pendingConversations: AssistantPendingConversationSummary[];
  pendingProposalCount: number;
  /** The remembered transcript has not been read back yet. Distinct from an
   * empty conversation, so the rail can wait instead of greeting someone who
   * already has a discussion on this view. */
  hydrating: boolean;
  historySyncStatus: AssistantHistorySyncStatus | null;
  retryHistorySync?: () => void;
};

type AssistantConversationStateProps = {
  activeConversationId: string | null;
  children?: (view: AssistantConversationView) => ReactNode;
  contextKey: string;
  handle: string;
  ownerScopeReady: boolean;
  storeKey: string | null;
};

/**
 * The revision-driven transcript boundary for the assistant rail.
 *
 * Keeping this subscription below the workspace shell means streamed text can
 * redraw the conversation without re-running the document library, editor,
 * selection model, and navigation tree. The controller still owns the active
 * conversation id, native/cloud turn fences, and every mutation callback.
 */
export function AssistantConversationState({
  activeConversationId,
  children,
  contextKey,
  handle,
  ownerScopeReady,
  storeKey,
}: AssistantConversationStateProps) {
  const conversationRevision = useSyncExternalStore(
    subscribeAssistantConversations,
    () => (storeKey ? assistantConversationRevision(storeKey) : -1),
    serverAssistantConversationRevision,
  );

  const scope = ownerScopeReady && storeKey ? `${handle}\u001f${storeKey}` : null;
  const currentScope = useRef(scope);
  useLayoutEffect(() => {
    currentScope.current = scope;
    return () => {
      currentScope.current = null;
    };
  }, [scope]);
  const [syncState, setSyncState] = useState<{
    scope: string;
    status: AssistantHistorySyncStatus;
    retry: () => void;
  } | null>(null);
  const retryHistorySync =
    syncState?.scope === scope ? syncState.retry : undefined;

  useEffect(() => {
    if (!scope || !storeKey) return;
    const loop = startAssistantConversationSync({
      storeKey,
      sync: (local) => syncAssistantConversationsAction(handle, local, storeKey),
      isCurrent: () => currentScope.current === scope,
      onStatus: (status) =>
        setSyncState({ scope, status, retry: () => loop.retry() }),
    });
    return () => {
      loop.dispose();
    };
  }, [handle, scope, storeKey]);

  const historySyncStatus = scope
    ? syncState?.scope === scope ? syncState.status : "local"
    : null;

  const view = useMemo<AssistantConversationView>(() => {
    if (
      !ownerScopeReady ||
      conversationRevision < 0 ||
      !storeKey ||
      !activeConversationId
    ) {
      return {
        conversations: EMPTY_CONVERSATIONS,
        messages: EMPTY_MESSAGES,
        pendingConversations: EMPTY_PENDING_CONVERSATIONS,
        pendingProposalCount: 0,
        hydrating: true,
        historySyncStatus: null,
      };
    }
    return {
      conversations: assistantConversationSummaries(storeKey, contextKey),
      messages: assistantConversationMessages(storeKey, activeConversationId),
      pendingConversations: pendingAssistantConversationSummaries(storeKey),
      pendingProposalCount: pendingAssistantProposalCount(storeKey),
      hydrating: false,
      historySyncStatus,
      retryHistorySync,
    };
  }, [
    historySyncStatus,
    retryHistorySync,
    activeConversationId,
    contextKey,
    conversationRevision,
    ownerScopeReady,
    storeKey,
  ]);

  return children ? children(view) : null;
}
