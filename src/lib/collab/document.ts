import * as Y from "yjs";
import {
  validateDocumentSnapshot,
  type DocumentAsset,
  type DocumentFieldValue,
  type DocumentSnapshot,
} from "@/lib/documents/model";

const ROOT_KEY = "document";

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
): void {
  for (const key of Array.from(target.keys())) {
    if (!(key in value)) target.delete(key);
  }
  for (const [key, entry] of Object.entries(value)) target.set(key, entry);
}

function replaceArray(target: Y.Array<unknown>, value: unknown[]): void {
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
    replaceMap(map(rootMap, "presentation"), {
      templateId: snapshot.presentation.template.id,
      templateVersion: snapshot.presentation.template.version,
      theme: snapshot.presentation.theme,
    });
  }, origin);
}

function cleanFields(value: Record<string, unknown>): Record<string, DocumentFieldValue> {
  return value as Record<string, DocumentFieldValue>;
}

export function documentSnapshotFromYDoc(doc: Y.Doc): DocumentSnapshot {
  const rootMap = root(doc);
  const presentation = map(rootMap, "presentation");
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
      theme:
        (presentation.get("theme") as DocumentSnapshot["presentation"]["theme"] | undefined) ??
        {},
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
