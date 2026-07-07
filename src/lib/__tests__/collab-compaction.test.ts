import { describe, expect, it } from "vitest";
import * as Y from "yjs";

// The compaction invariant, tested at the Yjs level (the DB wrapper in
// collab.ts is exercised by the live smoke). Compaction merges the whole
// update log into one snapshot; these prove that is lossless and that a
// concurrent update which was NOT part of the snapshot still converges.

function textOf(updates: Uint8Array[]): string {
  const doc = new Y.Doc();
  for (const u of updates) Y.applyUpdate(doc, u);
  return doc.getText("t").toString();
}

describe("collab compaction (Yjs merge invariant)", () => {
  it("a merged snapshot reproduces the exact document of the full log", () => {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on("update", (u) => updates.push(u));
    // Many small edits, the shape compaction collapses.
    doc.getText("t").insert(0, "Hello ");
    doc.getText("t").insert(6, "there ");
    doc.getText("t").insert(12, "world");
    doc.getText("t").delete(0, 6); // "there world"
    doc.getText("t").insert(0, "Well, ");

    const full = textOf(updates);
    const snapshot = Y.mergeUpdates(updates);
    const compacted = textOf([snapshot]);

    expect(compacted).toBe(full);
    expect(compacted).toBe("Well, there world");
  });

  it("an update that arrives during compaction is not lost when applied with the snapshot", () => {
    // docA accumulates the history that gets compacted.
    const docA = new Y.Doc();
    const history: Uint8Array[] = [];
    docA.on("update", (u) => history.push(u));
    docA.getText("t").insert(0, "base ");
    docA.getText("t").insert(5, "content");

    // A concurrent editor (docB) makes an edit from the same base but its
    // update lands AFTER the snapshot was computed from `history`.
    const docB = new Y.Doc();
    for (const u of history) Y.applyUpdate(docB, u);
    docB.getText("t").insert(docB.getText("t").length, " plus concurrent");
    const concurrent = Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA));

    const snapshot = Y.mergeUpdates(history);

    // A fresh joiner receives snapshot + the surviving concurrent row (in
    // either order: Yjs updates are commutative).
    expect(textOf([snapshot, concurrent])).toBe("base content plus concurrent");
    expect(textOf([concurrent, snapshot])).toBe("base content plus concurrent");
  });

  it("applying the snapshot is idempotent for a client that already had the history", () => {
    const doc = new Y.Doc();
    const history: Uint8Array[] = [];
    doc.on("update", (u) => history.push(u));
    doc.getText("t").insert(0, "already applied");

    const snapshot = Y.mergeUpdates(history);
    // Client already applied the history; re-applying the snapshot must not
    // duplicate or corrupt anything.
    Y.applyUpdate(doc, snapshot);
    expect(doc.getText("t").toString()).toBe("already applied");
  });
});
