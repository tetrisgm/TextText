"use client";

import type {
  WorkspacePoolPayload,
  WorkspacePostBodyPayload,
} from "@/lib/pool/types";

const DB_NAME = "write-workspace-pool";
const DB_VERSION = 1;
const POOL_STORE = "pools";
const BODY_STORE = "bodies";

type StoreName = typeof POOL_STORE | typeof BODY_STORE;

function openPoolDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(POOL_STORE)) {
        db.createObjectStore(POOL_STORE);
      }
      if (!db.objectStoreNames.contains(BODY_STORE)) {
        db.createObjectStore(BODY_STORE);
      }
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
  });
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
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result ?? null);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      resolve(null);
    };
  });
}

function bodyKey(blogId: string, postId: string): string {
  return `${blogId}:${postId}`;
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
