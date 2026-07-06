// The action audit: every mutation, whoever drove it, leaves one row saying
// who did what to what. Recording must never break the mutation it describes,
// so failures are swallowed after a console warning.

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
  try {
    await db.insert(actionAudit).values({
      actorUserId: entry.actorUserId ?? null,
      actorType: entry.actorType,
      actionName: entry.actionName,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      inputSummary: clip(entry.inputSummary),
      outputSummary: clip(entry.outputSummary),
    });
  } catch (error) {
    console.warn("action audit write failed", error);
  }
}
