/**
 * Deleting an account.
 *
 * This file owns the ORDER. The primitives live in store.ts; nothing else knows
 * the whole sequence, and nothing else should.
 *
 * The shape is CLOSE then PURGE.
 *
 * CLOSE is one atomic batch that stamps blogs.deleted_at, revokes the tokens,
 * writes the tombstone and writes the audit row. That single deleted_at UPDATE
 * is the load-bearing move: every read path filters it, so one committed
 * statement takes down the public pages, the feeds, the sync API and workspace
 * resolution together, and it cannot half-apply. After CLOSE the account is
 * unusable even if everything below fails.
 *
 * PURGE is the irreversible part, and it is deliberately NOT one transaction.
 * The Neon HTTP driver has no interactive transactions, and the blob deletes are
 * network calls to another service that no database transaction could cover
 * anyway. So it is written as a resumable sequence instead: each phase exists
 * because the next one is blocked by a NO ACTION foreign key or by an address
 * that is about to be destroyed, and an interrupted run can be finished later
 * from the tombstone.
 *
 * Two things are deliberately NOT destroyed.
 *
 * action_audit rows have their actor nulled and are never deleted. They are the
 * accountability record for every mutation, including ones made by AI and by
 * external agents, and that record has to outlive the person leaving.
 *
 * The five ON DELETE SET NULL references are left exactly as the schema handles
 * them: comments this person wrote on other people's documents, templates they
 * authored elsewhere, capability links they minted there. The author becomes
 * null and the row survives with its author-name snapshot. That is other
 * people's workspaces, and deleting from them is not this operation's business.
 * There are no OAuth grants to revoke: agent access is a workspace token, and
 * api_tokens is revoked above (OAuth removed 2026-08-15).
 */

import { auditInsertQuery } from "@/lib/audit";
import { purgeWorkspaceBlobs } from "@/lib/blob-purge";
import { db, executeAtomicBatch } from "@/lib/db/client";
import {
  apiTokens,
  blogs,
  deletedAccounts,
} from "@/lib/db/schema";
import {
  anonymizeAuditActor,
  completeAccountTombstone,
  deleteUserRow,
  deleteWorkspaceRow,
  findAccountTombstone,
  getAccountDeletionSummary,
  hashAccountSub,
  listWorkspaceAssetUrls,
  purgeUserIdentityRows,
  purgeWorkspaceContent,
  type AccountDeletionSummary,
} from "@/lib/store";
import { and, eq, isNull } from "drizzle-orm";

type AccountDeletionStep =
  | "close"
  | "blobs"
  | "content"
  | "workspace"
  | "identity"
  | "audit"
  | "finish";

/**
 * The order, as data, so it can be asserted without a database.
 *
 * Each entry says why it sits where it does. If one of these moves, something
 * downstream breaks in a way that is hard to see in review.
 */
export function accountDeletionPlan(): {
  step: AccountDeletionStep;
  because: string;
}[] {
  return [
    {
      step: "close",
      because:
        "One atomic batch. Everything after this is cleanup on an account that is already unusable.",
    },
    {
      step: "blobs",
      because:
        "Before any row is deleted: the rows carry the only addresses these files have, and the handle is the only prefix key.",
    },
    {
      step: "content",
      because:
        "Collab rows before posts, since collab_state holds a post foreign key; then posts, folders, idempotency keys.",
    },
    {
      step: "workspace",
      because:
        "The blogs row, once nothing references it. Cascades the AI config and the templates.",
    },
    {
      step: "identity",
      because:
        "The user-level rows that block DELETE FROM users, plus the residue that no foreign key reaches.",
    },
    {
      step: "audit",
      because:
        "Null the actor on the history. Never a delete, and it must precede the users row that it references.",
    },
    {
      step: "finish",
      because:
        "The users row last, then mark the tombstone complete.",
    },
  ];
}

/**
 * CLOSE. One batch, five statements, every one unconditional and addressed by
 * id. The audit row is written HERE, while the users row still exists to
 * satisfy action_audit.actor_user_id; a moment later there would be nothing for
 * that foreign key to point at.
 */
export async function closeAccount(
  summary: AccountDeletionSummary,
): Promise<void> {
  const subHash = hashAccountSub(summary.sub);
  const now = new Date();
  await executeAtomicBatch((executor) => [
    executor
      .update(blogs)
      .set({ deletedAt: now })
      .where(
        and(
          eq(blogs.id, summary.blogId),
          eq(blogs.ownerId, summary.userId),
          isNull(blogs.deletedAt),
        ),
      ),
    executor
      .update(apiTokens)
      .set({ revokedAt: now })
      .where(
        and(eq(apiTokens.userId, summary.userId), isNull(apiTokens.revokedAt)),
      ),
    executor.insert(deletedAccounts).values({
      subHash,
      userId: summary.userId,
      blogId: summary.blogId,
      username: summary.username,
      handle: summary.handle,
    }),
    auditInsertQuery(
      {
        actorUserId: summary.userId,
        actorType: "human",
        actionName: "delete_account",
        targetType: "workspace",
        targetId: summary.blogId,
        inputSummary: `documents=${summary.documents} published=${summary.publishedDocuments} collaborators=${summary.collaborators} tokens=${summary.apiTokens}`,
      },
      executor,
    ),
  ]);
}

/**
 * PURGE. Resumable: every phase is safe to run again, so an interrupted run can
 * be finished from the tombstone rather than leaving rows nobody can reach.
 * A blob failure warns and continues, because storage being down must not stop
 * a person from deleting their account.
 */
export async function purgeAccount(
  summary: AccountDeletionSummary,
): Promise<void> {
  const blobUrls = await listWorkspaceAssetUrls(summary.blogId);
  await purgeWorkspaceBlobs({
    handle: summary.handle,
    urls: blobUrls,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  await purgeWorkspaceContent(summary.blogId);
  await deleteWorkspaceRow(summary.blogId);
  await purgeUserIdentityRows(summary.userId, summary.sub, summary.email);
  await anonymizeAuditActor(summary.userId);
  await deleteUserRow(summary.userId);
  await completeAccountTombstone(hashAccountSub(summary.sub));
}

type AccountDeletionOutcome = {
  closed: boolean;
  complete: boolean;
};

/**
 * The whole thing. Returns closed=true as soon as CLOSE commits, because from
 * that instant the account is gone as far as anyone can observe, and reporting
 * failure afterwards would be a lie.
 */
export async function executeAccountDeletion(
  summary: AccountDeletionSummary,
): Promise<AccountDeletionOutcome> {
  await closeAccount(summary);
  try {
    await purgeAccount(summary);
    return { closed: true, complete: true };
  } catch (error) {
    console.error("account purge incomplete; tombstone left open", error);
    return { closed: true, complete: false };
  }
}

/**
 * Finish a purge that was interrupted. Called when the same identity signs in
 * again, and by scripts/finish-pending-account-deletions.ts.
 *
 * Deliberately re-derives nothing from the live tables: by this point the
 * workspace read paths no longer resolve the handle, so the tombstone is the
 * only remaining record of what has to be cleaned up.
 */
export async function resumeAccountDeletion(sub: string): Promise<boolean> {
  if (!db) return false;
  const tombstone = await findAccountTombstone(sub);
  if (!tombstone || tombstone.completedAt) return true;
  if (!tombstone.userId || !tombstone.blogId || !tombstone.handle) {
    // Nothing addressable left to purge; close it out rather than retrying
    // forever on every sign-in.
    await completeAccountTombstone(tombstone.subHash);
    return true;
  }
  try {
    await purgeAccount({
      userId: tombstone.userId,
      sub,
      email: null,
      username: tombstone.username,
      blogId: tombstone.blogId,
      handle: tombstone.handle,
      workspaceName: "",
      documents: 0,
      publishedDocuments: 0,
      collaborators: 0,
      apiTokens: 0,
      hasCloudAiKey: false,
    });
    return true;
  } catch (error) {
    console.error("resuming account deletion failed", error);
    return false;
  }
}

export { getAccountDeletionSummary };
