// The action audit: every mutation, whoever drove it, leaves one row saying
// who did what to what. Recording must never break the mutation it describes,
// so a transient failure is retried once and only then swallowed with a loud
// warning.
//
// Atomicity note: the audit row is a separate statement from the mutation. The
// neon-http driver has no interactive transactions, so a truly atomic
// mutation+audit would mean folding the INSERT into each mutation's SQL as a
// data-modifying CTE (a large, high-risk change to the core save path). The
// pragmatic posture is a retried best-effort write: with the revision
// compare-and-swap, a retried mutation is safe, and the one uncovered window
// (process death between the mutation and the audit insert) is vanishingly
// rare. Fully atomic audit is tracked as a follow-up.

import { db } from "./db/client";
import { actionAudit } from "./db/schema";

export type AuditActorType = "human" | "ai" | "external_agent";
export type AuditTargetType = "workspace" | "folder" | "item" | "mode";

export type AuditEntry = {
  /** users.id when known; null for guest (cookie) editors */
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

export async function recordAction(entry: AuditEntry): Promise<void> {
  if (!db) return; // demo mode has no durable audit
  const values = {
    actorUserId: entry.actorUserId ?? null,
    actorType: entry.actorType,
    actionName: entry.actionName,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    inputSummary: clip(entry.inputSummary),
    outputSummary: clip(entry.outputSummary),
  };
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
