import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { agentTextChanges, AgentChangeConflictError, inverseTextChange } from "@/lib/agent-changes";
import { applyDocumentMutation, applyDocumentSnapshot, documentRoot, documentSnapshotFromYDoc, documentText } from "@/lib/collab/document";
import { emptyDocumentSnapshot } from "@/lib/documents/model";

function snapshot(body: string) {
  const result = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
  result.content.body = body;
  result.content.title = "Title";
  return result;
}
const change = { field: "body" as const, before: "Intro. Old paragraph. Ending.", after: "Intro. Agent paragraph. Ending." };

describe("durable agent text inverses", () => {
  it.each([
    [change.after, change.before],
    ["Human. " + change.after, "Human. " + change.before],
    [change.after + " Human.", change.before + " Human."],
  ])("preserves unrelated typing in %s", (current, expected) => {
    const inverse = inverseTextChange(change, current);
    expect(current.slice(0, inverse.start) + inverse.replacementText + current.slice(inverse.end)).toBe(expected);
  });

  it.each(["Intro. Human paragraph. Ending.", "Intro. AgXent paragraph. Ending.", "", "Intro. Ending."])
    ("returns a comparison for overlapping text: %s", (current) => {
      try { inverseTextChange(change, current); throw new Error("Expected conflict"); }
      catch (error) {
        expect(error).toBeInstanceOf(AgentChangeConflictError);
        expect((error as AgentChangeConflictError).comparisons).toEqual([{ ...change, current }]);
      }
    });

  it("refuses ambiguous placement when repeated text could put a human edit on either side", () => {
    expect(() => inverseTextChange({ field: "body", before: "aaaXaaa", after: "aaaaaa" }, "aaaaa"))
      .toThrow(AgentChangeConflictError);
  });

  it.each([
    ["A. End", "A. New. End"], ["A. Deleted. End", "A. End"],
    ["", "Agent"], ["Agent", ""], ["😀 before 🌱", "😀 after 🌱"],
  ])("reverses insertions, deletions and Unicode", (before, after) => {
    const doc = new Y.Doc(); applyDocumentSnapshot(doc, snapshot(after));
    applyDocumentMutation(doc, { revertChanges: [{ field: "body", before, after }] });
    expect(documentText(doc, "body").toString()).toBe(before); doc.destroy();
  });

  it.each(["reload", "compaction", "epoch rotation"])("works after %s without an undo stack or relay history", (mode) => {
    const doc = new Y.Doc(); applyDocumentSnapshot(doc, snapshot(change.before));
    const before = documentSnapshotFromYDoc(doc);
    applyDocumentMutation(doc, { body: change.after }, "external-agent");
    const records = JSON.parse(JSON.stringify(agentTextChanges(before, documentSnapshotFromYDoc(doc))));
    documentText(doc, "body").insert(0, "Human. ");
    const fresh = new Y.Doc();
    if (mode === "epoch rotation") applyDocumentSnapshot(fresh, documentSnapshotFromYDoc(doc));
    else Y.applyUpdate(fresh, mode === "compaction" ? Y.mergeUpdates([Y.encodeStateAsUpdate(doc)]) : Y.encodeStateAsUpdate(doc));
    doc.destroy();
    applyDocumentMutation(fresh, { revertChanges: records, operationId: "revert:1" });
    expect(documentText(fresh, "body").toString()).toBe("Human. " + change.before);
    expect(applyDocumentMutation(fresh, { revertChanges: records, operationId: "revert:1" })).toBe(false);
    fresh.destroy();
  });

  it("validates every field before changing any field or operation metadata", () => {
    const doc = new Y.Doc(); applyDocumentSnapshot(doc, snapshot("Human overlap"));
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => applyDocumentMutation(doc, { operationId: "revert:2", revertChanges: [
      { field: "title", before: "Old title", after: "Title" }, change,
    ] })).toThrow(AgentChangeConflictError);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(documentText(doc, "title").toString()).toBe("Title"); doc.destroy();
  });

  it("keeps Cmd+Z human-only with real remote agent and revert deltas", () => {
    const human = new Y.Doc(); applyDocumentSnapshot(human, snapshot(change.before), "seed");
    const origin = Symbol("human");
    const undo = new Y.UndoManager(documentRoot(human), { trackedOrigins: new Set([origin]), captureTimeout: 0 });
    const agent = new Y.Doc(); Y.applyUpdate(agent, Y.encodeStateAsUpdate(human));
    const vector = Y.encodeStateVector(agent);
    applyDocumentMutation(agent, { body: change.after }, "agent");
    Y.applyUpdate(human, Y.encodeStateAsUpdate(agent, vector), "remote");
    human.transact(() => documentText(human, "body").insert(0, "Human. "), origin);
    Y.applyUpdate(agent, Y.encodeStateAsUpdate(human), "remote");
    const revertVector = Y.encodeStateVector(agent);
    applyDocumentMutation(agent, { revertChanges: [change] }, "revert");
    Y.applyUpdate(human, Y.encodeStateAsUpdate(agent, revertVector), "remote");
    expect(documentText(human, "body").toString()).toBe("Human. " + change.before);
    undo.undo(); expect(documentText(human, "body").toString()).toBe(change.before);
    undo.undo(); expect(documentText(human, "body").toString()).toBe(change.before);
    undo.destroy(); human.destroy(); agent.destroy();
  });
});
