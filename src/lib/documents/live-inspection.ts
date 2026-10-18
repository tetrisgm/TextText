"use client";

import { requireDocumentSnapshot, type DocumentSnapshot } from "./model";

type Reader = () => DocumentSnapshot;
type Inspection = Readonly<{
  version: 1;
  read: (itemId: string) => DocumentSnapshot | null;
}>;

declare global {
  interface Window {
    readonly texttextDocumentInspection?: Inspection;
  }
}

const readers = new Map<string, Map<symbol, Reader>>();

function validateItemId(itemId: string): void {
  if (typeof itemId !== "string" || !itemId.trim() || itemId.length > 256 || /[\u0000-\u001f\u007f]/.test(itemId)) {
    throw new Error("Invalid open document identity");
  }
}

const inspection: Inspection = Object.freeze({
  version: 1,
  read(itemId: string): DocumentSnapshot | null {
    validateItemId(itemId);
    const entries = readers.get(itemId);
    if (!entries?.size) return null;
    if (entries.size !== 1) throw new Error("Multiple live editors have this document open");
    const reader = entries.values().next().value!;
    // Only the current editor is read. Detach before returning so inspection
    // cannot mutate editor state, and validate the complete schema each time.
    return requireDocumentSnapshot(JSON.parse(JSON.stringify(reader())), "Open editor");
  },
});

/** Exposes only already loaded editable documents; never flushes or loads data. */
export function registerLiveDocumentInspector(itemId: string, reader: Reader): () => void {
  validateItemId(itemId);
  if (typeof window !== "undefined" && window.texttextDocumentInspection !== inspection) {
    Object.defineProperty(window, "texttextDocumentInspection", {
      value: inspection, configurable: true, enumerable: false, writable: false,
    });
  }
  const token = Symbol(itemId);
  const entries = readers.get(itemId) ?? new Map<symbol, Reader>();
  entries.set(token, reader);
  readers.set(itemId, entries);
  return () => {
    entries.delete(token);
    if (!entries.size && readers.get(itemId) === entries) readers.delete(itemId);
  };
}
