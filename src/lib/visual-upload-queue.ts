"use client";

/** Browser recovery copy for a dropped image until the server confirms it. */
export type PendingVisualUpload = {
  id: string;
  handle: string;
  folderPath: string;
  name: string;
  contentType: string;
  file: Blob;
  createdAt: number;
};

const DATABASE = "texttext-visual-uploads";
const STORE = "pending";
const MAX_PENDING = 6;
const MAX_PENDING_BYTES = 100 * 1024 * 1024;

function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Device storage is unavailable."));
    request.onblocked = () => reject(new Error("Device storage is busy. Close another TextText tab and retry."));
  });
}

export async function listPendingVisualUploads(): Promise<PendingVisualUpload[]> {
  const db = await openQueue();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    let records: PendingVisualUpload[] = [];
    tx.objectStore(STORE).getAll().onsuccess = (event) => {
      records = (event.target as IDBRequest<PendingVisualUpload[]>).result;
    };
    tx.oncomplete = () => { db.close(); resolve(records); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Could not read pending images.")); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Could not read pending images.")); };
  });
}

export async function rememberVisualUpload(record: PendingVisualUpload): Promise<void> {
  const pending = await listPendingVisualUploads();
  if (pending.length >= MAX_PENDING || pending.reduce((bytes, item) => bytes + item.file.size, record.file.size) > MAX_PENDING_BYTES) {
    throw new Error("Six images or 100 MB are waiting to upload. Retry one before adding more.");
  }
  const db = await openQueue();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Could not keep this image on this device.")); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Could not keep this image on this device.")); };
  });
}

export async function forgetVisualUpload(id: string): Promise<void> {
  const db = await openQueue();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Could not clear the saved upload.")); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Could not clear the saved upload.")); };
  });
}
