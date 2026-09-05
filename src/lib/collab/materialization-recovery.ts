import type { DocumentSnapshot } from "@/lib/documents/model";

export type MaterializationRecovery = {
  id: string;
  postId: string;
  epoch: number | null;
  state: string;
  document: DocumentSnapshot;
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
