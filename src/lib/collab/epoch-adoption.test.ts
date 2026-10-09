import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { emptyDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { applyDocumentSnapshot, documentSnapshotFromYDoc, documentRoot, documentText, hasDocumentSnapshot } from "./document";
import { DocumentUndoManager } from "./text-transactions";
import { EpochUndoHistory, captureUndoHistory, caretAfterBodyChange, mapSelection, mapTextOffset, replayBodyEdits, replayHistoryStep } from "./epoch-adoption";

function note(body: string): DocumentSnapshot {
  const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
  document.content.body = body;
  return document;
}

describe("mapTextOffset", () => {
  it("keeps a caret after text inserted before it and before text inserted after it", () => {
    expect(mapTextOffset("Hello local", "Hello remote local", 11)).toBe(18);
    expect(mapTextOffset("Hello local", "Hello local remote", 5)).toBe(5);
    expect(mapTextOffset("Hello local", "Hello remote local", 2)).toBe(2);
  });
  it("collapses a caret inside removed text to the removal point and clamps out-of-range offsets", () => {
    expect(mapTextOffset("Hello pending world", "Hello world", 9)).toBe(6);
    expect(mapTextOffset("abc", "abcdef", 99)).toBe(6);
    expect(mapTextOffset("abc", "xyz", -4)).toBe(0);
    expect(mapTextOffset("same", "same", 3)).toBe(3);
  });
  it("maps a selection endpoint by endpoint", () => {
    expect(mapSelection("one two", "zero one two", { anchor: 0, head: 3 })).toEqual({ anchor: 0, head: 8 });
  });
  it("places the caret at the end of a history step's change", () => {
    expect(caretAfterBodyChange("Hello local", "Hello")).toBe(5);
    expect(caretAfterBodyChange("Hello", "Hello local")).toBe(11);
    expect(caretAfterBodyChange("Remote: Hello local", "Remote: Hello")).toBe(13);
    expect(caretAfterBodyChange("same", "same")).toBe(4);
  });
});

describe("captured undo history", () => {
  function editor() {
    const doc = new Y.Doc();
    const origin = Symbol("user");
    applyDocumentSnapshot(doc, note("Hello"), "seed");
    const manager = new DocumentUndoManager(documentRoot(doc), { trackedOrigins: new Set([origin]), captureTimeout: 0 });
    const type = (at: number, text: string) => doc.transact(() => documentText(doc, "body").insert(at, text), origin);
    const snapshot = () => hasDocumentSnapshot(doc) ? documentSnapshotFromYDoc(doc) : null;
    return { doc, manager, type, snapshot };
  }

  it("records each old step as a text state and restores the document it walked", () => {
    const { doc, manager, type, snapshot } = editor();
    type(5, " one"); type(9, " two"); manager.undo();
    const captured = captureUndoHistory(manager, snapshot)!;
    expect(captured.current.content.body).toBe("Hello one");
    expect(captured.undo.map(state => state.content.body)).toEqual(["Hello"]);
    expect(captured.redo.map(state => state.content.body)).toEqual(["Hello one two"]);
    doc.destroy();
  });

  it("replays an old undo on the replacement document while keeping edits made there", () => {
    const { manager, type, snapshot } = editor();
    type(5, " local");
    const captured = captureUndoHistory(manager, snapshot)!;
    const history = new EpochUndoHistory(captured);
    // The replacement epoch merged a remote change and a later remote edit arrived.
    const live = note("Remote: Hello local");
    const back = history.stepBack(live)!;
    expect(back.document.content.body).toBe("Remote: Hello");
    expect(back.bodyEdits).toEqual([{ start: 13, end: 19, replacement: "" }]);
    expect(history.canUndo).toBe(false);
    expect(history.nextRedo()).toBe("captured");
    const forward = history.stepForward(note("Again Remote: Hello"))!;
    expect(forward.document.content.body).toBe("Again Remote: Hello local");
    expect(history.nextRedo()).toBe(null);
  });

  it("orders live and captured steps so redo retraces undo", () => {
    const history = new EpochUndoHistory({ current: note("Hello local"), undo: [note("Hello")], redo: [] });
    expect(history.stepBack(note("Hello local"))?.document.content.body).toBe("Hello");
    history.noteEdit(); // typing after the undo discards the redo path
    expect(history.nextRedo()).toBe(null);
    history.noteLiveUndo();
    expect(history.nextRedo()).toBe("live");
    history.noteLiveRedo();
    expect(history.nextRedo()).toBe(null);
  });

  it("ends the captured history instead of guessing when a step conflicts with later edits", () => {
    const history = new EpochUndoHistory({ current: note("Hello local"), undo: [note("Hello")], redo: [] });
    expect(history.stepBack(note("Hello lxcal"))).toBeNull();
    expect(history.canUndo).toBe(false);
    expect(replayHistoryStep(note("a b"), note("a"), note("a c"))).toBeNull();
  });

  it("undoes a pending edit beside the remote text the adoption merged in, and redoes it behind that text", () => {
    // The merge placed the remote insertion first, right where the pending edit began.
    const history = new EpochUndoHistory({ current: note("Hello local"), undo: [note("Hello")], redo: [] });
    const back = history.stepBack(note("Hello remote local"))!;
    expect(back.document.content.body).toBe("Hello remote");
    expect(back.bodyEdits).toEqual([{ start: 12, end: 18, replacement: "" }]);
    const forward = history.stepForward(note("Hello remote"))!;
    expect(forward.document.content.body).toBe("Hello remote local");
    expect(forward.bodyEdits).toEqual([{ start: 12, end: 12, replacement: " local" }]);
    expect(replayBodyEdits("ab cd", "ab XY", "ab cd!")).toEqual({ body: "ab XY!", edits: [{ start: 3, end: 5, replacement: "XY" }] });
    expect(replayBodyEdits("ab cd", "ab", "ab cXd")).toBeNull();
  });
});
