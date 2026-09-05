import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workspaceAssistantConversationHistories } from "@/lib/db/schema";
import {
  assistantConversationSyncFingerprint,
  cleanAssistantConversationSyncPayload,
  mergeAssistantConversationSyncPayloads,
  type SyncedAssistantConversation,
  capAssistantConversationSyncPayload,
} from "@/lib/ai/assistant-conversation-sync";

/**
 * Merges one owner's local replica into the workspace row. Ownership is
 * established by the action before a blog id can reach this boundary.
 */
export async function syncWorkspaceAssistantConversationHistory(
  blogId: string,
  localInput: unknown,
): Promise<SyncedAssistantConversation[]> {
  if (!db) throw new Error("Conversation sync needs a configured database.");
  const local = cleanAssistantConversationSyncPayload(localInput);
  // A plain read-merge-upsert loses one replica when two devices sync at the
  // same time. Use updatedAt as an optimistic compare-and-swap and retry the
  // merge against the winner. This works with both local Postgres and Neon's
  // stateless HTTP driver, where an interactive row lock is unavailable.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [row] = await db
      .select({
        conversations: workspaceAssistantConversationHistories.conversations,
        updatedAt: workspaceAssistantConversationHistories.updatedAt,
      })
      .from(workspaceAssistantConversationHistories)
      .where(eq(workspaceAssistantConversationHistories.blogId, blogId))
      .limit(1);
    const merged = capAssistantConversationSyncPayload(
      mergeAssistantConversationSyncPayloads(row?.conversations ?? [], local),
    );
    // The rail syncs on every launch. When the local replica adds nothing,
    // the merge equals what is stored; writing it back again would be a
    // database write per launch for no change.
    if (
      row &&
      assistantConversationSyncFingerprint(row.conversations ?? []) ===
        assistantConversationSyncFingerprint(merged)
    ) {
      return merged;
    }
    const nextUpdatedAt = new Date(
      Math.max(Date.now(), (row?.updatedAt.getTime() ?? 0) + 1),
    );
    if (!row) {
      const inserted = await db
        .insert(workspaceAssistantConversationHistories)
        .values({
          blogId,
          conversations: merged as Array<Record<string, unknown>>,
          updatedAt: nextUpdatedAt,
        })
        .onConflictDoNothing({
          target: workspaceAssistantConversationHistories.blogId,
        })
        .returning({ blogId: workspaceAssistantConversationHistories.blogId });
      if (inserted.length > 0) return merged;
      continue;
    }
    const updated = await db
      .update(workspaceAssistantConversationHistories)
      .set({
        conversations: merged as Array<Record<string, unknown>>,
        updatedAt: nextUpdatedAt,
      })
      .where(
        and(
          eq(workspaceAssistantConversationHistories.blogId, blogId),
          eq(workspaceAssistantConversationHistories.updatedAt, row.updatedAt),
        ),
      )
      .returning({ blogId: workspaceAssistantConversationHistories.blogId });
    if (updated.length > 0) return merged;
  }
  throw new Error("Conversation sync was busy. The local copy is unchanged.");
}
