"use client";

import { documentSnapshotSchema } from "@/lib/documents/model";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type {
  WorkspacePostBodyPayload,
  WorkspacePostDocumentPayload,
} from "@/lib/pool/types";
import type { DraftState } from "@/lib/post-edit-draft";

const DB_NAME = "texttext-workspace-pool";
const DB_VERSION = 2;
const BODY_STORE = "bodies";
const DRAFT_STORE = "drafts";
const DRAFT_LOCAL_PREFIX = "texttext:workspace-draft:v1:";

type StoreName = typeof BODY_STORE | typeof DRAFT_STORE;

let poolDbPromise: Promise<IDBDatabase | null> | null = null;
let lastDraftWriteVersion = 0;

type PersistedWorkspaceDraft = {
  blogId: string;
  postId: string;
  draft: DraftState;
  key: string;
  baseUpdatedAt?: string;
  persistedAt: string;
};

type StoredWorkspaceDraft =
  | (PersistedWorkspaceDraft & {
      deleted?: false;
      writeVersion?: number;
    })
  | {
      blogId: string;
      postId: string;
      key: string;
      persistedAt: string;
      deleted: true;
      writeVersion: number;
    };

function nextDraftWriteVersion(): number {
  const clockVersion = Date.now() * 1_000;
  lastDraftWriteVersion = Math.max(clockVersion, lastDraftWriteVersion + 1);
  return lastDraftWriteVersion;
}

function openPoolDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (poolDbPromise) return poolDbPromise;
  poolDbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BODY_STORE)) {
        db.createObjectStore(BODY_STORE);
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE);
      }
    };
    request.onerror = () => {
      poolDbPromise = null;
      resolve(null);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        poolDbPromise = null;
      };
      resolve(db);
    };
  });
  return poolDbPromise;
}

async function withStore<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openPoolDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const transaction = db.transaction(storeName, mode);
    const request = run(transaction.objectStore(storeName));
    let result: T | null = null;
    request.onsuccess = () => {
      result = request.result ?? null;
    };
    transaction.oncomplete = () => {
      resolve(result);
    };
    transaction.onerror = () => {
      resolve(null);
    };
    transaction.onabort = () => {
      resolve(null);
    };
  });
}

function bodyKey(blogId: string, postId: string): string {
  return `${blogId}:${postId}`;
}

function draftLocalKey(blogId: string, postId: string): string {
  return `${DRAFT_LOCAL_PREFIX}${bodyKey(blogId, postId)}`;
}

function readLocalDraftRecord(
  blogId: string,
  postId: string,
): StoredWorkspaceDraft | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(draftLocalKey(blogId, postId));
    if (!raw) return undefined;
    const record = JSON.parse(raw) as StoredWorkspaceDraft;
    if (record.blogId !== blogId || record.postId !== postId) return undefined;
    return record;
  } catch {
    return undefined;
  }
}

function writeLocalDraftRecord(record: StoredWorkspaceDraft): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      draftLocalKey(record.blogId, record.postId),
      JSON.stringify(record),
    );
  } catch {
    // IndexedDB remains the durable fallback for unusually large drafts.
  }
}

function clearLocalDraftTombstone(
  blogId: string,
  postId: string,
  writeVersion: number,
): void {
  if (typeof localStorage === "undefined") return;
  const current = readLocalDraftRecord(blogId, postId);
  if (!current?.deleted || current.writeVersion !== writeVersion) return;
  try {
    localStorage.removeItem(draftLocalKey(blogId, postId));
  } catch {
    // The IndexedDB tombstone remains authoritative.
  }
}

function publicDraftSnapshot(
  record: PersistedWorkspaceDraft & {
    deleted?: false;
    writeVersion?: number;
  },
): PersistedWorkspaceDraft {
  return {
    blogId: record.blogId,
    postId: record.postId,
    draft: record.draft,
    key: record.key,
    baseUpdatedAt: record.baseUpdatedAt,
    persistedAt: record.persistedAt,
  };
}

export function normalizeStoredPostDocument(
  value: unknown,
  expected: {
    blogId: string;
    postId: string;
    fallbackDocument?: DocumentSnapshot;
  },
): WorkspacePostDocumentPayload | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as Partial<WorkspacePostDocumentPayload> &
    Partial<WorkspacePostBodyPayload>;
  if (stored.blogId !== expected.blogId || stored.postId !== expected.postId) {
    return null;
  }

  const parsedDocument = documentSnapshotSchema.safeParse(stored.document);
  const document = parsedDocument.success
    ? parsedDocument.data
    : typeof stored.body === "string" && expected.fallbackDocument
      ? {
          ...expected.fallbackDocument,
          content: {
            ...expected.fallbackDocument.content,
            body: stored.body,
          },
        }
      : null;
  if (!document) return null;

  return {
    blogId: expected.blogId,
    postId: expected.postId,
    document,
    revision:
      typeof stored.revision === "number" ? stored.revision : undefined,
    updatedAt:
      typeof stored.updatedAt === "string" ? stored.updatedAt : undefined,
    fetchedAt:
      typeof stored.fetchedAt === "string"
        ? stored.fetchedAt
        : new Date().toISOString(),
    body: document.content.body,
  };
}

export async function readPersistedPostDocument(
  blogId: string,
  postId: string,
  fallbackDocument?: DocumentSnapshot,
): Promise<WorkspacePostDocumentPayload | null> {
  const stored = await withStore<unknown>(BODY_STORE, "readonly", (store) =>
    store.get(bodyKey(blogId, postId)),
  );
  const document = normalizeStoredPostDocument(stored, {
    blogId,
    postId,
    fallbackDocument,
  });
  if (document && !(stored as { document?: unknown } | null)?.document) {
    void persistPostDocument(document);
  }
  return document;
}

export async function persistPostDocument(
  document: WorkspacePostDocumentPayload,
): Promise<void> {
  await withStore<IDBValidKey>(BODY_STORE, "readwrite", (store) =>
    store.put(document, bodyKey(document.blogId, document.postId)),
  );
}

export async function deletePersistedPostDocument(
  blogId: string,
  postId: string,
): Promise<void> {
  await withStore<undefined>(BODY_STORE, "readwrite", (store) =>
    store.delete(bodyKey(blogId, postId)),
  );
}

export async function readPersistedWorkspaceDraft(
  blogId: string,
  postId: string,
): Promise<PersistedWorkspaceDraft | null> {
  const local = readLocalDraftRecord(blogId, postId);
  if (local) {
    if (local.deleted) return null;
    return publicDraftSnapshot(local);
  }
  const stored = await withStore<StoredWorkspaceDraft>(
    DRAFT_STORE,
    "readonly",
    (store) => store.get(bodyKey(blogId, postId)),
  );
  if (!stored || stored.deleted) return null;
  return publicDraftSnapshot(stored);
}

export async function persistWorkspaceDraft(
  snapshot: PersistedWorkspaceDraft,
): Promise<void> {
  const key = bodyKey(snapshot.blogId, snapshot.postId);
  const incoming: StoredWorkspaceDraft = {
    ...snapshot,
    writeVersion: nextDraftWriteVersion(),
  };
  writeLocalDraftRecord(incoming);
  const db = await openPoolDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(DRAFT_STORE, "readwrite");
    const store = transaction.objectStore(DRAFT_STORE);
    const request = store.get(key);
    request.onsuccess = () => {
      const current = request.result as StoredWorkspaceDraft | undefined;
      if ((current?.writeVersion ?? 0) <= (incoming.writeVersion ?? 0)) {
        store.put(incoming, key);
      }
    };
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      resolve();
    };
    transaction.onabort = () => {
      resolve();
    };
  });
}

export async function deletePersistedWorkspaceDraft(
  blogId: string,
  postId: string,
  expectedKey?: string,
): Promise<void> {
  const key = bodyKey(blogId, postId);
  const writeVersion = nextDraftWriteVersion();
  const local = readLocalDraftRecord(blogId, postId);
  if (
    (local?.writeVersion ?? 0) <= writeVersion &&
    (!expectedKey || (!local?.deleted && local?.key === expectedKey))
  ) {
    writeLocalDraftRecord({
      blogId,
      postId,
      key: expectedKey ?? local?.key ?? "",
      persistedAt: new Date().toISOString(),
      deleted: true,
      writeVersion,
    });
  }
  const db = await openPoolDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(DRAFT_STORE, "readwrite");
    const store = transaction.objectStore(DRAFT_STORE);
    const request = store.get(key);
    request.onsuccess = () => {
      const current = request.result as StoredWorkspaceDraft | undefined;
      if ((current?.writeVersion ?? 0) > writeVersion) return;
      if (
        expectedKey &&
        (!current || current.deleted || current.key !== expectedKey)
      ) {
        return;
      }
      const tombstone: StoredWorkspaceDraft = {
        blogId,
        postId,
        key: expectedKey ?? current?.key ?? "",
        persistedAt: new Date().toISOString(),
        deleted: true,
        writeVersion,
      };
      store.put(tombstone, key);
    };
    transaction.oncomplete = () => {
      clearLocalDraftTombstone(blogId, postId, writeVersion);
      resolve();
    };
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

/**
 * Wipes every local copy of the workspace: the IndexedDB pool, the cached
 * bodies, and the drafts held in localStorage.
 *
 * Called when an account is deleted. Without it the person's documents and
 * unsaved drafts stay readable on the device after the account is gone, which
 * is both a broken promise and a real problem on a shared machine.
 */
export async function clearWorkspaceStorage(): Promise<void> {
  if (typeof window === "undefined") return;
  // Drop the cached handle first: deleteDatabase blocks while a connection is
  // still open, and would otherwise wait for this tab to go away.
  try {
    const existing = await poolDbPromise;
    existing?.close();
  } catch {
    // Never opened, or already closed.
  }
  poolDbPromise = null;

  if (typeof indexedDB !== "undefined") {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = finish;
        request.onerror = finish;
        // Another tab still holds it. Local data is best effort here; the
        // server side is already gone.
        request.onblocked = finish;
      } catch {
        finish();
      }
    });
  }

  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(DRAFT_LOCAL_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // Storage disabled or full; nothing further to do.
  }
}
