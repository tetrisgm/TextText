export type NativeTurnFence = {
  conversationId: string;
  handle: string;
  ownerScopeKey: string;
  threadKey: string;
};

export type AssistantOwnerScope = {
  handle: string;
  ownerScopeKey: string | null;
};

export function assistantOwnerScopeMatches(
  current: AssistantOwnerScope,
  expected: AssistantOwnerScope,
): boolean {
  return Boolean(
    current.ownerScopeKey &&
      expected.ownerScopeKey &&
      current.handle === expected.handle &&
      current.ownerScopeKey === expected.ownerScopeKey,
  );
}

/**
 * A native event belongs to a turn only when all three durable identities still
 * match. Missing conversation IDs fail closed because accepting an untagged
 * event lets a late App Server turn cross a workspace navigation boundary.
 */
export function nativeEventMatchesTurnFence(input: {
  currentHandle: string;
  currentOwnerScopeKey: string | null;
  eventConversationId?: string;
  fence: NativeTurnFence | null;
}): input is typeof input & {
  eventConversationId: string;
  fence: NativeTurnFence;
} {
  const { currentHandle, currentOwnerScopeKey, eventConversationId, fence } =
    input;
  return Boolean(
    fence &&
      eventConversationId &&
      currentOwnerScopeKey &&
      fence.handle === currentHandle &&
      fence.ownerScopeKey === currentOwnerScopeKey &&
      fence.conversationId === eventConversationId,
  );
}
