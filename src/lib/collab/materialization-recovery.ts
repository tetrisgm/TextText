import type { DocumentSnapshot } from "@/lib/documents/model";

export type RecoveryReason = "document-changed" | "sync-rejected" | "outbox-conflict" | "access-lost" | "trashed" | "local-recovery";

export function recoveryHeading(copies: Pick<MaterializationRecovery, "reason">[]): string {
  if (copies.some((copy) => copy.reason === "trashed")) return "This document was moved to Trash";
  if (copies.some((copy) => copy.reason === "access-lost")) return "Access to this document was lost";
  if (copies.some((copy) => copy.reason === "sync-rejected")) return "These edits could not be synced";
  if (copies.length && copies.every((copy) => copy.reason === "document-changed")) return "This document changed elsewhere";
  return "Your local edits need recovery";
}

export type MaterializationRecovery = {
  /** Optional for recovery records written before reasons were recorded. */
  reason?: RecoveryReason;
  id: string;
  postId: string;
  epoch: number | null;
  state: string;
  document?: DocumentSnapshot;
  /** Durable retired-outbox copies also retain undecodable/raw operations. */
  outboxKey?: string;
  updates?: string[];
  baselineRevision?: number | null;
};
const PREFIX = "texttext:collab-recovery:v1:";

// Separate from the live cache/outbox: never replay these states automatically.
export function keepMaterializationRecovery(copy: MaterializationRecovery): boolean {
  try {
    localStorage.setItem(PREFIX + copy.id, JSON.stringify(copy));
    return true;
  } catch {
    return false;
  }
}

export function readMaterializationRecoveries(postId: string): MaterializationRecovery[] {
  const copies: MaterializationRecovery[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const copy = JSON.parse(localStorage.getItem(key) ?? "null");
        if (copy?.postId === postId && typeof copy.state === "string" && copy.document) {
          copies.push(copy);
        }
      } catch { /* Leave unreadable records intact. */ }
    }
  } catch { /* Storage can be unavailable; the mounted editor keeps its copy. */ }
  return copies;
}

/** Called only after the person downloads these copies and opens the current item. */
export function acknowledgeMaterializationRecoveries(copies: MaterializationRecovery[]): void {
  for (const copy of copies) {
    try { localStorage.removeItem(PREFIX + copy.id); } catch { /* Keep on failure. */ }
  }
}
