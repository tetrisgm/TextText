import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyDocumentSnapshot,
  documentRoot,
  documentText,
} from "@/lib/collab/document";
import { emptyDocumentSnapshot } from "@/lib/documents/model";

const SEED = (() => {
  const base = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
  return {
    ...base,
    content: { ...base.content, title: "Seeded title", body: "Seeded body text." },
  };
})();

/** The editor's arrangement: one origin for the person's edits, another for
 * seeding and reconciliation, and undo tracking only the former. */
function editorDoc() {
  const doc = new Y.Doc();
  const userEdit = Symbol("user-edit");
  const seeding = Symbol("seeding");
  applyDocumentSnapshot(doc, SEED, seeding);
  const undoManager = new Y.UndoManager(documentRoot(doc), {
    trackedOrigins: new Set([userEdit]),
    captureTimeout: 0,
  });
  return { doc, userEdit, seeding, undoManager };
}

describe("document undo", () => {
  it("undoes and redoes the person's own edit", () => {
    const { doc, userEdit, undoManager } = editorDoc();
    const body = documentText(doc, "body");
    doc.transact(() => body.insert(0, "NEW "), userEdit);
    expect(body.toString()).toBe("NEW Seeded body text.");
    undoManager.undo();
    expect(body.toString()).toBe("Seeded body text.");
    undoManager.redo();
    expect(body.toString()).toBe("NEW Seeded body text.");
  });

  it("NEVER undoes the seed, however far back it is pushed", () => {
    const { doc, userEdit, undoManager } = editorDoc();
    const body = documentText(doc, "body");
    doc.transact(() => body.insert(0, "NEW "), userEdit);
    for (let i = 0; i < 10; i += 1) undoManager.undo();
    // The document is still the document. Tracking the seeding origin here
    // would have emptied it on the second undo.
    expect(body.toString()).toBe("Seeded body text.");
    expect(documentText(doc, "title").toString()).toBe("Seeded title");
  });

  it("does not reach through a collaborator's work", () => {
    const { doc, userEdit, undoManager } = editorDoc();
    const body = documentText(doc, "body");
    const remote = Symbol("remote-peer");
    doc.transact(() => body.insert(0, "MINE "), userEdit);
    doc.transact(() => body.insert(0, "THEIRS "), remote);
    undoManager.undo();
    // Mine is gone, theirs is untouched.
    expect(body.toString()).toBe("THEIRS Seeded body text.");
  });

  it("tracks the root map, so a text replaced after mount is still covered", () => {
    const doc = new Y.Doc();
    const userEdit = Symbol("user-edit");
    // The manager is built BEFORE the document has any content, the way the
    // editor builds it at mount.
    const undoManager = new Y.UndoManager(documentRoot(doc), {
      trackedOrigins: new Set([userEdit]),
      captureTimeout: 0,
    });
    applyDocumentSnapshot(doc, SEED, Symbol("seeding"));
    const body = documentText(doc, "body");
    doc.transact(() => body.insert(0, "LATER "), userEdit);
    undoManager.undo();
    expect(body.toString()).toBe("Seeded body text.");
  });
});
