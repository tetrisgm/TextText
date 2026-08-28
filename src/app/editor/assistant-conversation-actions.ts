"use server";

import { createHash } from "node:crypto";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { syncWorkspaceAssistantConversationHistory } from "@/lib/ai/assistant-conversation-history.server";
import type { SyncedAssistantConversation } from "@/lib/ai/assistant-conversation-sync";

type AssistantConversationSyncState = {
  allowed: boolean;
  conversations: SyncedAssistantConversation[];
};

export async function getAssistantConversationCacheScopeAction(
  handleInput: unknown,
): Promise<string | null> {
  try {
    const access = await getBlogEditAccess(cleanHandle(handleInput));
    if (!access.isOwner || !access.blogId || !access.ownerId) return null;
    return createHash("sha256")
      .update(`texttext-assistant-history\0${access.ownerId}\0${access.blogId}`)
      .digest("hex")
      .slice(0, 32);
  } catch {
    return null;
  }
}

function cleanHandle(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Collaborator access is deliberately insufficient for private AI history. */
export async function syncAssistantConversationsAction(
  handleInput: unknown,
  conversationsInput: unknown,
): Promise<AssistantConversationSyncState> {
  try {
    const access = await getBlogEditAccess(cleanHandle(handleInput));
    if (!access.isOwner || !access.blogId || !access.ownerId) {
      return { allowed: false, conversations: [] };
    }
    return {
      allowed: true,
      conversations: await syncWorkspaceAssistantConversationHistory(
        access.blogId,
        conversationsInput,
      ),
    };
  } catch {
    // Sync is background-only. Local history remains authoritative offline.
    return { allowed: false, conversations: [] };
  }
}
