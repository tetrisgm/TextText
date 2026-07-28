import * as Y from "yjs";
import {
  validateDocumentSnapshot,
  type DocumentAsset,
  type DocumentFieldValue,
  type DocumentSnapshot,
} from "@/lib/documents/model";

const ROOT_KEY = "document";
const APPLIED_OPERATIONS_KEY = "agentOperations";
const MAX_APPLIED_OPERATIONS = 256;

export type DocumentMutation = {
  title?: string;
  subtitle?: string | null;
  body?: string;
  appendBody?: string;
  tags?: string[];
  operationId?: string;
};

function root(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(ROOT_KEY);
}

function text(rootMap: Y.Map<unknown>, key: string): Y.Text {
  const existing = rootMap.get(key);
  if (existing instanceof Y.Text) return existing;
  const value = new Y.Text();
  rootMap.set(key, value);
  return value;
}

function map(rootMap: Y.Map<unknown>, key: string): Y.Map<unknown> {
  const existing = rootMap.get(key);
  if (existing instanceof Y.Map) return existing;
  const value = new Y.Map<unknown>();
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    for (const [entryKey, entryValue] of Object.entries(existing)) {
      value.set(entryKey, entryValue);
    }
  }
  rootMap.set(key, value);
  return value;
}

function array(rootMap: Y.Map<unknown>, key: string): Y.Array<unknown> {
  const existing = rootMap.get(key);
  if (existing instanceof Y.Array) return existing;
  const value = new Y.Array<unknown>();
  rootMap.set(key, value);
  return value;
}

function replaceText(target: Y.Text, value: string): void {
  if (target.toString() === value) return;
  target.delete(0, target.length);
  if (value) target.insert(0, value);
}

function replaceMap(
  target: Y.Map<unknown>,
  value: Record<string, unknown>,
  preservedKeys: ReadonlySet<string> = new Set(),
): void {
  for (const key of Array.from(target.keys())) {
    if (!preservedKeys.has(key) && !(key in value)) target.delete(key);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (JSON.stringify(target.get(key)) !== JSON.stringify(entry)) {
      target.set(key, entry);
    }
  }
}

function replaceArray(target: Y.Array<unknown>, value: unknown[]): void {
  if (JSON.stringify(target.toArray()) === JSON.stringify(value)) return;
  if (target.length) target.delete(0, target.length);
  if (value.length) target.insert(0, value);
}

export function applyDocumentSnapshot(
  doc: Y.Doc,
  snapshotInput: DocumentSnapshot,
  origin: unknown = "document-seed",
): void {
  const snapshot = validateDocumentSnapshot(snapshotInput);
  doc.transact(() => {
    const rootMap = root(doc);
    rootMap.set("schemaVersion", snapshot.schemaVersion);
    replaceText(text(rootMap, "title"), snapshot.content.title);
    replaceText(text(rootMap, "subtitle"), snapshot.content.subtitle ?? "");
    replaceText(text(rootMap, "body"), snapshot.content.body);
    replaceMap(map(rootMap, "fields"), snapshot.content.fields);
    replaceArray(array(rootMap, "tags"), snapshot.content.tags);
    replaceArray(array(rootMap, "assets"), snapshot.content.assets);
    const presentation = map(rootMap, "presentation");
    replaceMap(presentation, {
      templateId: snapshot.presentation.template.id,
      templateVersion: snapshot.presentation.template.version,
    }, new Set(["theme"]));
    replaceMap(map(presentation, "theme"), snapshot.presentation.theme);
  }, origin);
}

export function applyDocumentMutation(
  doc: Y.Doc,
  mutation: DocumentMutation,
  origin: unknown = "document-mutation",
): boolean {
  let applied = true;
  doc.transact(() => {
    const rootMap = root(doc);
    const operations = map(rootMap, APPLIED_OPERATIONS_KEY);
    if (mutation.operationId && operations.has(mutation.operationId)) {
      applied = false;
      return;
    }
    if (mutation.title !== undefined) {
      replaceText(text(rootMap, "title"), mutation.title);
    }
    if (mutation.subtitle !== undefined) {
      replaceText(text(rootMap, "subtitle"), mutation.subtitle ?? "");
    }
    if (mutation.body !== undefined) {
      replaceText(text(rootMap, "body"), mutation.body);
    }
    if (mutation.appendBody !== undefined) {
      const fragment = mutation.appendBody.trim();
      if (fragment) {
        const body = text(rootMap, "body");
        const current = body.toString().trimEnd();
        if (current.length < body.length) {
          body.delete(current.length, body.length - current.length);
        }
        body.insert(body.length, current ? `\n\n${fragment}` : fragment);
      }
    }
    if (mutation.tags !== undefined) {
      replaceArray(array(rootMap, "tags"), mutation.tags);
    }
    if (mutation.operationId) {
      operations.set(mutation.operationId, Date.now());
      if (operations.size > MAX_APPLIED_OPERATIONS) {
        const oldest = Array.from(operations.entries())
          .map(([key, value]) => ({
            key,
            timestamp: typeof value === "number" ? value : 0,
          }))
          .sort(
            (left, right) =>
              left.timestamp - right.timestamp ||
              left.key.localeCompare(right.key),
          )
          .slice(0, operations.size - MAX_APPLIED_OPERATIONS);
        for (const entry of oldest) operations.delete(entry.key);
      }
    }
  }, origin);
  return applied;
}

function cleanFields(value: Record<string, unknown>): Record<string, DocumentFieldValue> {
  return value as Record<string, DocumentFieldValue>;
}

export function documentSnapshotFromYDoc(doc: Y.Doc): DocumentSnapshot {
  const rootMap = root(doc);
  const presentation = map(rootMap, "presentation");
  const storedTheme = presentation.get("theme");
  const theme =
    storedTheme instanceof Y.Map
      ? storedTheme.toJSON()
      : storedTheme && typeof storedTheme === "object" && !Array.isArray(storedTheme)
        ? storedTheme
        : {};
  return validateDocumentSnapshot({
    schemaVersion: 1,
    content: {
      title: text(rootMap, "title").toString(),
      subtitle: text(rootMap, "subtitle").toString() || undefined,
      body: text(rootMap, "body").toString(),
      fields: cleanFields(map(rootMap, "fields").toJSON()),
      tags: array(rootMap, "tags").toArray() as string[],
      assets: array(rootMap, "assets").toArray() as DocumentAsset[],
    },
    presentation: {
      template: {
        id: String(presentation.get("templateId") ?? "texttext.article"),
        version: Number(presentation.get("templateVersion") ?? 1),
      },
      theme,
    },
  });
}

export function createDocumentYDoc(snapshot?: DocumentSnapshot): Y.Doc {
  const doc = new Y.Doc();
  if (snapshot) applyDocumentSnapshot(doc, snapshot);
  return doc;
}

function stableSeedClientId(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
}

/**
 * Encode the canonical snapshot as a deterministic Yjs baseline. The baseline
 * is persisted once per collaboration epoch. Determinism also lets an offline
 * client seed the same revision without creating a second independent text
 * history when it reconnects.
 */
export function encodeDocumentBaseline(
  snapshotInput: DocumentSnapshot,
  seed: string,
): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = stableSeedClientId(seed);
  try {
    applyDocumentSnapshot(doc, snapshotInput, "document-baseline");
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

export function applyDocumentBaseline(
  target: Y.Doc,
  snapshot: DocumentSnapshot,
  seed: string,
  origin: unknown = "document-baseline",
): void {
  Y.applyUpdate(target, encodeDocumentBaseline(snapshot, seed), origin);
}

export function hasDocumentSnapshot(doc: Y.Doc): boolean {
  return root(doc).get("schemaVersion") === 1;
}

export function documentText(doc: Y.Doc, key: "title" | "subtitle" | "body"): Y.Text {
  return text(root(doc), key);
}

export function documentFields(doc: Y.Doc): Y.Map<unknown> {
  return map(root(doc), "fields");
}

export function documentTags(doc: Y.Doc): Y.Array<unknown> {
  return array(root(doc), "tags");
}

export function documentAssets(doc: Y.Doc): Y.Array<unknown> {
  return array(root(doc), "assets");
}

export function documentPresentation(doc: Y.Doc): Y.Map<unknown> {
  return map(root(doc), "presentation");
}

export function documentTheme(doc: Y.Doc): Y.Map<unknown> {
  return map(documentPresentation(doc), "theme");
}
