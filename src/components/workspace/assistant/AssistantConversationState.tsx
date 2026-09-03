"use client";

import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { syncAssistantConversationsAction } from "@/app/editor/assistant-conversation-actions";
import {
  assistantConversationMessages,
  assistantConversationRevision,
  assistantConversationSummaries,
  assistantConversationSyncPayload,
  mergeSyncedAssistantConversations,
  pendingAssistantConversationSummaries,
  pendingAssistantProposalCount,
  serverAssistantConversationRevision,
  subscribeAssistantConversations,
  type AssistantConversationSummary,
  type AssistantPendingConversationSummary,
} from "./conversation-store";
import type { AssistantMessage } from "./useNativeAssistant";

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

  useEffect(() => {
    if (conversationRevision < 0 || !storeKey) return;
    const timeout = window.setTimeout(() => {
      const local = assistantConversationSyncPayload(storeKey);
      void syncAssistantConversationsAction(handle, local)
        .then((result) => {
          if (result.allowed) {
            mergeSyncedAssistantConversations(storeKey, result.conversations);
          }
        })
        .catch(() => {
          // The local replica remains fully usable while offline.
        });
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [conversationRevision, handle, storeKey]);

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
      };
    }
    return {
      conversations: assistantConversationSummaries(storeKey, contextKey),
      messages: assistantConversationMessages(storeKey, activeConversationId),
      pendingConversations: pendingAssistantConversationSummaries(storeKey),
      pendingProposalCount: pendingAssistantProposalCount(storeKey),
      hydrating: false,
    };
  }, [
    activeConversationId,
    contextKey,
    conversationRevision,
    ownerScopeReady,
    storeKey,
  ]);

  return children ? children(view) : null;
}
