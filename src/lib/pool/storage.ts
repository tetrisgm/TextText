"use client";

import type {
  WorkspacePoolPayload,
  WorkspacePostBodyPayload,
} from "@/lib/pool/types";
import type { DraftState } from "@/lib/post-edit-draft";

const DB_NAME = "texttext-workspace-pool";
const DB_VERSION = 2;
const POOL_STORE = "pools";
const BODY_STORE = "bodies";
const DRAFT_STORE = "drafts";
const DRAFT_LOCAL_PREFIX = "texttext:workspace-draft:v1:";

type StoreName = typeof POOL_STORE | typeof BODY_STORE | typeof DRAFT_STORE;

let poolDbPromise: Promise<IDBDatabase | null> | null = null;
let lastDraftWriteVersion = 0;

export type PersistedWorkspaceDraft = {
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
      if (!db.objectStoreNames.contains(POOL_STORE)) {
        db.createObjectStore(POOL_STORE);
      }
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

export async function readPersistedPool(
  blogId: string,
): Promise<WorkspacePoolPayload | null> {
  return withStore<WorkspacePoolPayload>(POOL_STORE, "readonly", (store) =>
    store.get(blogId),
  );
}

export async function persistPool(pool: WorkspacePoolPayload): Promise<void> {
  await withStore<IDBValidKey>(POOL_STORE, "readwrite", (store) =>
    store.put(pool, pool.blogId),
  );
}

export async function readPersistedPostBody(
  blogId: string,
  postId: string,
): Promise<WorkspacePostBodyPayload | null> {
  return withStore<WorkspacePostBodyPayload>(BODY_STORE, "readonly", (store) =>
    store.get(bodyKey(blogId, postId)),
  );
}

export async function persistPostBody(
  body: WorkspacePostBodyPayload,
): Promise<void> {
  await withStore<IDBValidKey>(BODY_STORE, "readwrite", (store) =>
    store.put(body, bodyKey(body.blogId, body.postId)),
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

export async function movePersistedWorkspaceDraft(
  blogId: string,
  previousPostId: string,
  postId: string,
): Promise<void> {
  const current = await readPersistedWorkspaceDraft(blogId, previousPostId);
  if (!current) return;
  await persistWorkspaceDraft({
    ...current,
    postId,
    persistedAt: new Date().toISOString(),
  });
  await deletePersistedWorkspaceDraft(blogId, previousPostId, current.key);
}
