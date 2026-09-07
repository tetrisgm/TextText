import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import { applyDocumentMutation, applyDocumentSnapshot, createDocumentYDoc, documentRoot, documentSnapshotFromYDoc, documentText } from "../document";
import { MAX_TEXT_CHUNK_UNITS, MAX_UPDATE_CHARS } from "../limits";
import { DocumentUndoManager, replaceSharedText } from "../text-transactions";
import { applyPreReadyTextOperations } from "../pre-ready";
import { emptyDocumentSnapshot } from "@/lib/documents/model";

const large = "a😀漢e\u0301\r\n".repeat(100_000);
function seeded(body = "left RIGHT") {
  const snapshot = emptyDocumentSnapshot(); snapshot.content.body = body;
  return createDocumentYDoc(snapshot);
}
function capture(doc: Y.Doc) {
  const updates: Uint8Array[] = [];
  doc.on("update", (update) => updates.push(update));
  return updates;
}
function bounded(updates: Uint8Array[]) {
  expect(updates.length).toBeGreaterThan(1);
  for (const update of updates) expect(Buffer.from(update).toString("base64").length).toBeLessThan(MAX_UPDATE_CHARS);
}

it("derives the insertion budget from the real base64 ceiling and reserves half for overhead", () => {
  expect(MAX_TEXT_CHUNK_UNITS).toBe(Math.floor(Math.floor(MAX_UPDATE_CHARS / 4) * 3 / 2 / 3));
});

it.each(["x".repeat(600_000), large])("inserts a large string exactly, preserving code points across updates (%#)", (value) => {
  const doc = seeded();
  // The peer must share identities, not merely the same visible seed.
  const remote = new Y.Doc(); Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  const updates = capture(doc);
  replaceSharedText(documentText(doc, "body"), 5, 0, value, "paste");
  bounded(updates);
  for (const update of updates) Y.applyUpdate(remote, update);
  expect(documentText(doc, "body").toString()).toBe(`left ${value}RIGHT`);
  expect(documentText(remote, "body").toString()).toBe(`left ${value}RIGHT`);
  doc.destroy(); remote.destroy();
});

it.each(["body", "append", "section", "range", "snapshot", "pre-ready", "revert"])("bounds the %s entry point", (path) => {
  const doc = seeded("# Part\n\nold\n\n# Next\n\nkeep"), updates = capture(doc);
  if (path === "body") applyDocumentMutation(doc, { body: large });
  if (path === "append") applyDocumentMutation(doc, { appendBody: large });
  if (path === "section") applyDocumentMutation(doc, { bodySection: { heading: "Part", expectedBody: "old", replacementBody: large } });
  if (path === "range") applyDocumentMutation(doc, { textRange: { field: "body", start: 8, end: 11, expectedText: "old", replacementText: large } });
  if (path === "snapshot") { const next = documentSnapshotFromYDoc(doc); next.content.body = large; applyDocumentSnapshot(doc, next); }
  if (path === "pre-ready") applyPreReadyTextOperations(documentText(doc, "body"), [{ start: 8, end: 11, insert: large }], "ready");
  if (path === "revert") {
    applyDocumentMutation(doc, { revertChanges: [{ field: "body", before: `# Part\n\n${large}\n\n# Next\n\nkeep`, after: "# Part\n\nold\n\n# Next\n\nkeep" }] });
  }
  bounded(updates);
  const text = documentText(doc, "body").toString();
  expect(text).toContain(path === "append" || path === "section" ? large.trim() : large);
  doc.destroy();
});

it("converges with a peer inserting and deleting while it receives the paste, even with duplicate/out-of-order delivery", () => {
  const doc = seeded(), peer = new Y.Doc();
  const baseline = Y.encodeStateAsUpdate(doc); Y.applyUpdate(peer, baseline);
  const changes = capture(doc), peerChanges = capture(peer);
  let edits = 0;
  const deliver = (update: Uint8Array) => {
    Y.applyUpdate(peer, update, "remote");
    if (edits++ === 0) {
      peer.transact(() => {
        documentText(peer, "body").insert(8, "[peer]"); // inside the first chunk
        documentText(peer, "body").delete(documentText(peer, "body").length - 5, 5);
      }, "peer");
    }
  };
  doc.on("update", deliver);
  replaceSharedText(documentText(doc, "body"), 5, 0, large, "paste");
  doc.off("update", deliver);
  // Network callbacks cannot interrupt the synchronous local paste. The peer
  // can edit after any delivered chunk; its changes arrive on the next turn.
  for (const update of [...peerChanges].reverse()) Y.applyUpdate(doc, update, "remote");
  expect(documentText(doc, "body").toString()).toBe(documentText(peer, "body").toString());
  expect(documentText(doc, "body").toString().replace("[peer]", "")).toBe(`left ${large}`);
  expect(documentText(doc, "body").toString().split("[peer]")).toHaveLength(2);
  expect(documentText(doc, "body").toString()).toBe(`left ${large.slice(0, 3)}[peer]${large.slice(3)}`);
  const late = new Y.Doc();
  Y.applyUpdate(late, baseline);
  for (const update of [...changes].reverse()) { Y.applyUpdate(late, update); Y.applyUpdate(late, update); }
  expect(documentText(late, "body").toString()).toBe(documentText(doc, "body").toString());
  doc.destroy(); peer.destroy(); late.destroy();
});

it("one undo/redo action preserves peer edits and keeps restoration updates bounded, even after slow transactions", () => {
  const old = "漢😀".repeat(100_000), doc = seeded(old), origin = Symbol("person");
  const manager = new DocumentUndoManager(documentRoot(doc), { trackedOrigins: new Set([origin]), captureTimeout: 400 });
  // Earlier typing is not swallowed by the paste's history group.
  replaceSharedText(documentText(doc, "body"), 0, 0, "A", origin);
  const updates = capture(doc);
  let now = 1_000;
  const time = vi.spyOn(Date, "now").mockImplementation(() => now += 1_000);
  try {
    replaceSharedText(documentText(doc, "body"), 1, old.length, large, origin);
    doc.transact(() => documentText(doc, "body").insert(0, "peer "), "peer");
    manager.undo(); expect(documentText(doc, "body").toString()).toBe(`peer A${old}`);
    manager.redo(); expect(documentText(doc, "body").toString()).toBe(`peer A${large}`);
    bounded(updates);
    manager.undo(); manager.undo(); expect(documentText(doc, "body").toString()).toBe(`peer ${old}`);
  } finally { time.mockRestore(); manager.destroy(); doc.destroy(); }
});

it("also bounds a reconciliation made of many individually small insertions", () => {
  const doc = seeded("");
  const updates = capture(doc), insert = "漢".repeat(MAX_TEXT_CHUNK_UNITS - 1);
  applyPreReadyTextOperations(documentText(doc, "body"), Array.from({ length: 8 }, () => ({ start: 0, end: 0, insert })), "ready");
  bounded(updates);
  expect(documentText(doc, "body").toString()).toBe(insert.repeat(8));
  doc.destroy();
});
