// The action audit: every mutation, whoever drove it, leaves one row saying
// who did what to what.
//
// ATOMICITY. The neon-http driver has no interactive transactions, but it does
// expose the Neon HTTP transaction two ways, and this file provides both so the
// high-consequence mutations write their audit row in the SAME transaction as
// the mutation (never a mutated row without provenance, never a phantom audit):
//
//   - auditCteFrom(): a data-modifying CTE for GUARDED (revision-CAS) mutations,
//     where the audit lands iff the guard matched a row. Used by deletePostAtomic
//     and movePostFile (a deleted or moved/renamed post is atomically audited).
//   - auditInsertQuery(): an unexecuted INSERT to fold into db.batch([...]) for
//     UNCONDITIONAL (addressed-by-id) mutations. Used by the share grant / role /
//     revoke path (a permission change is atomically audited).
//
// The remaining callers stay BEST-EFFORT via recordAction() below: the routine
// content save (savePost, the hot path with ~20 call sites and returned-revision
// semantics, where an atomic rewrite is high-risk for a CAS-safe operation) and
// the one-time / self-healing paths (workspace provisioning, bookmark recapture,
// comments, workspace claim, token mint). For those, recordAction retries once
// and then swallows with a loud warning; the only uncovered window (process
// death between the committed mutation and the audit insert) is vanishingly rare
// and, on those paths, low-consequence. Converting savePost to an atomic audit
// is a deliberate, separately-gated follow-up (see docs and the golden save
// tests), not something to fold in casually.

import { sql, type SQL } from "drizzle-orm";
import { db, type Database } from "./db/client";
import { actionAudit } from "./db/schema";

export type AuditActorType = "human" | "ai" | "external_agent";
export type AuditTargetType = "workspace" | "folder" | "item" | "mode";

export type AuditEntry = {
  /** users.id when known; null when no account is attached */
  actorUserId?: string | null;
  actorType: AuditActorType;
  /** e.g. "save_post", "sync.put_file", "mcp.create_item" */
  actionName: string;
  targetType: AuditTargetType;
  targetId?: string | null;
  inputSummary?: string;
  outputSummary?: string;
};

function clip(value: string | undefined, max = 300): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 3)}...`;
}

/** The normalized action_audit column values, shared by the best-effort insert
 * (recordAction) and the atomic in-transaction paths (auditCteFrom). */
export function auditValues(entry: AuditEntry) {
  return {
    actorUserId: entry.actorUserId ?? null,
    actorType: entry.actorType,
    actionName: entry.actionName,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    inputSummary: clip(entry.inputSummary),
    outputSummary: clip(entry.outputSummary),
  };
}

/**
 * A data-modifying CTE body that writes exactly ONE action_audit row, selecting
 * from an earlier CTE (named `fromCte`), so the audit row exists if and only if
 * that CTE produced a row. `targetId` is an SQL expression read from that CTE
 * (e.g. sql`changed.id::text`), because a guarded mutation's affected id is only
 * known post-execution.
 *
 * This is the primitive that makes a mutation and its audit GENUINELY ATOMIC on
 * the neon-http driver (which has no interactive transactions): fold both into
 * one statement,
 *
 *   WITH changed AS (UPDATE ... WHERE <revision guard> RETURNING id),
 *        audit   AS ( <auditCteFrom(entry, "changed", sql`changed.id::text`)> )
 *   SELECT ... FROM changed
 *
 * Postgres runs a data-modifying WITH clause to completion even when the primary
 * query does not reference it, so the audit lands precisely when `changed` is
 * non-empty and never when a revision conflict matched zero rows (which a naive
 * db.batch of an unconditional INSERT would get wrong, recording phantom rows).
 */
export function auditCteFrom(
  entry: AuditEntry,
  fromCte: string,
  targetId: SQL,
): SQL {
  const v = auditValues(entry);
  return sql`INSERT INTO ${actionAudit}
      (actor_user_id, actor_type, action_name, target_type, target_id, input_summary, output_summary)
    SELECT ${v.actorUserId}::uuid, ${v.actorType}, ${v.actionName}, ${v.targetType},
           ${targetId}, ${v.inputSummary}, ${v.outputSummary}
    FROM ${sql.identifier(fromCte)}`;
}

/**
 * An UNEXECUTED audit INSERT, for folding into a db.batch([...]) alongside an
 * UNCONDITIONAL mutation (one that always affects its row, addressed by id) so
 * both commit in one neon-http transaction. Do NOT batch this with a guarded
 * (revision-CAS) mutation: the insert would still run when the guard matched
 * zero rows, recording a phantom action; use auditCteFrom for guarded writes.
 */
export function auditInsertQuery(
  entry: AuditEntry,
  database: Database | null = db,
) {
  if (!database) throw new Error("auditInsertQuery needs a database");
  return database.insert(actionAudit).values(auditValues(entry));
}

export async function recordAction(entry: AuditEntry): Promise<void> {
  if (!db) return; // demo mode has no durable audit
  const values = auditValues(entry);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await db.insert(actionAudit).values(values);
      return;
    } catch (error) {
      if (attempt === 0) continue; // retry once for a transient failure
      // Loud, not silent: a missing audit row is a real gap even though it must
      // not fail the mutation it describes.
      console.error("action audit write failed after retry", entry.actionName, error);
    }
  }
}

export async function recordSlugChanged(
  entry: Pick<AuditEntry, "actorUserId" | "actorType" | "targetId"> & {
    oldSlug: string;
    newSlug: string;
  },
): Promise<void> {
  if (entry.oldSlug === entry.newSlug) return;
  await recordAction({
    actorUserId: entry.actorUserId,
    actorType: entry.actorType,
    actionName: "post.slug_changed",
    targetType: "item",
    targetId: entry.targetId,
    inputSummary: entry.oldSlug,
    outputSummary: entry.newSlug,
  });
}
