import * as Y from "yjs";
import { documentSnapshotFromYDoc, hasDocumentSnapshot } from "@/lib/collab/document";
import { documentSnapshotSchema } from "@/lib/documents/model";

export type LegacyRecoveryRecord = { storage: "localStorage" | "indexedDB"; database?: string; store?: string; key: string; raw: string };
export type LegacyRecoveryBundle = { version: 1; createdAt: string; records: LegacyRecoveryRecord[] };
const prefixes = ["texttext:vault-item-draft:", "texttext:vault-draft:", "texttext:workspace-draft:v1:", "texttext:file-collaboration:v1:", "texttext:file-collaboration:v2:"];
export const isLegacyRecoveryKey = (key: string) => prefixes.some(prefix => key.startsWith(prefix));
const LIMIT = 8 * 1024 * 1024;

function exactJSONRecord(value: unknown): string {
  const active = new Set<object>();
  const visit = (entry: unknown, depth: number): void => {
    if (depth > 64) throw new Error("A recovery record is too deeply nested. The original is preserved.");
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return;
    if (typeof entry === "number" && Number.isFinite(entry)) return;
    if (typeof entry !== "object" || active.has(entry) || (!Array.isArray(entry) && Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null))
      throw new Error("A saved draft has an unsupported format. Its original record is preserved.");
    active.add(entry);
    for (const child of Object.values(entry)) visit(child, depth + 1);
    active.delete(entry);
  };
  visit(value, 0);
  return JSON.stringify(value);
}

/** Read only known draft/journal stores. Never migrate, clear, acknowledge, or
 * submit these records. Divergent fallback and transactional copies both stay. */
export async function collectLegacyRecovery(storage: Storage, database: IDBFactory): Promise<LegacyRecoveryBundle> {
  const records: LegacyRecoveryRecord[] = [];
  let bytes = 0;
  const append = (record: LegacyRecoveryRecord) => {
    const size = new TextEncoder().encode(record.raw).byteLength;
    if (size > LIMIT || (bytes += size) > 64 * 1024 * 1024 || records.length >= 512) throw new Error("These drafts exceed the recovery viewer's limit. The original records are still saved.");
    records.push(record);
  };
  if (storage.length > 10_000) throw new Error("This profile has too many storage entries to inspect safely.");
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !isLegacyRecoveryKey(key)) continue;
    const raw = storage.getItem(key);
    if (raw !== null) append({ storage: "localStorage", key, raw });
  }
  for (const [name, store] of [["texttext-file-collaboration", "journals"], ["texttext-workspace-pool", "drafts"]]) {
    await new Promise<void>((resolve, reject) => {
      let connection: IDBDatabase | undefined, transaction: IDBTransaction | undefined, absent = false, settled = false;
      const finish = (error?: unknown) => {
        if (settled) return; settled = true; clearTimeout(timer); connection?.close();
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => { transaction?.abort(); finish(new Error("The older profile is busy. Close other TextText windows and retry.")); }, 5000);
      const request = database.open(name); // No version change is requested.
      request.onupgradeneeded = event => { absent = event.oldVersion === 0; request.transaction?.abort(); };
      request.onblocked = () => finish(new Error("The older profile is busy. Close other TextText windows and retry."));
      request.onerror = () => absent ? finish() : finish(request.error ?? new Error("Saved drafts could not be read."));
      request.onsuccess = () => {
        connection = request.result;
        if (settled) { connection.close(); return; }
        if (!connection.objectStoreNames.contains(store)) {
          // The first workspace cache predates durable drafts. Any other
          // missing store is an unknown layout, not proof that no work exists.
          const oldCache = name === "texttext-workspace-pool" && connection.version === 1 &&
            connection.objectStoreNames.length === 1 && connection.objectStoreNames.contains("bodies");
          finish(oldCache ? undefined : new Error("This older profile uses an unfamiliar storage layout. Its original records are preserved."));
          return;
        }
        connection.onversionchange = () => { transaction?.abort(); finish(new Error("The older profile changed. Retry to read its saved drafts.")); };
        try {
          transaction = connection.transaction(store, "readonly");
          const cursor = transaction.objectStore(store).openCursor();
          let visited = 0;
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row) return;
            try {
              if (++visited > 10_000) throw new Error("This profile has too many recovery records to inspect safely.");
              if (typeof row.key !== "string") throw new Error("A saved draft has an unsupported identity. Its original record is preserved.");
              const key = row.key;
              if (store === "drafts" || isLegacyRecoveryKey(key)) {
                const raw = exactJSONRecord(row.value);
                append({ storage: "indexedDB", database: name, store, key, raw });
              }
              row.continue();
            } catch (error) { transaction?.abort(); finish(error); }
          };
          cursor.onerror = () => finish(cursor.error ?? new Error("Saved drafts could not be read."));
          transaction.oncomplete = () => finish();
          transaction.onabort = () => finish(transaction?.error ?? new Error("Reading saved drafts was interrupted."));
          transaction.onerror = () => finish(transaction?.error ?? new Error("Saved drafts could not be read."));
        } catch (error) { finish(error); }
      };
    });
  }
  return { version: 1, createdAt: new Date().toISOString(), records };
}

/** Preview a copy only. The exact raw record always remains in the export. */
export function legacyRecoveryText(record: LegacyRecoveryRecord): { title: string; body: string } | null {
  try {
    if (record.raw.length > LIMIT) return null;
    let value = JSON.parse(record.raw);
    if (record.database === "texttext-file-collaboration") {
      if (typeof value.raw !== "string") return null;
      value = JSON.parse(value.raw);
    }
    const snapshot = documentSnapshotSchema.safeParse(value?.document);
    if (snapshot.success) return { title: snapshot.data.content.title, body: snapshot.data.content.body };
    if (value?.deleted === true) return null;
    if (value?.draft && typeof value.draft.title === "string" && typeof value.draft.body === "string") return { title: value.draft.title, body: value.draft.body };
    if (value?.version !== 1 || typeof value.update !== "string") return null;
    const doc = new Y.Doc();
    try {
      for (const update of [value.update, ...(Array.isArray(value.pending) ? value.pending : [])]) {
        if (typeof update !== "string" || update.length > LIMIT) return null;
        Y.applyUpdate(doc, Uint8Array.from(atob(update), character => character.charCodeAt(0)));
      }
      if (!hasDocumentSnapshot(doc) || doc.store.pendingStructs || doc.store.pendingDs) return null;
      const document = documentSnapshotFromYDoc(doc);
      return { title: document.content.title, body: document.content.body };
    } finally { doc.destroy(); }
  } catch { return null; }
}
