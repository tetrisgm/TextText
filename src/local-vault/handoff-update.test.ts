import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyDocumentSnapshot, documentSnapshotFromYDoc, documentText } from "@/lib/collab/document";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { prepareHandoffUpdate } from "./handoff-update";
const snapshot = (body: string, title = "Title") => { const value = emptyDocumentSnapshot({ id: "texttext.note", version: 1 }); return { ...value, content: { ...value.content, title, subtitle: "", body } }; };
function document(body: string) { const doc = new Y.Doc(); applyDocumentSnapshot(doc, snapshot(body)); return doc; }
function transfer(doc: Y.Doc, base: string, local: string) { const update = prepareHandoffUpdate(doc, snapshot(base), snapshot(local)); expect(update).not.toBeNull(); return update!; }

describe("exact handoff Yjs intent preparation", () => {
  it("does not mutate the live owner before the intent is persisted", () => {
    const doc = document("Hello"); const before = Y.encodeStateAsUpdate(doc);
    const update = transfer(doc, "Hello", "Hello L");
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    Y.applyUpdate(doc, update); expect(documentSnapshotFromYDoc(doc).content.body).toBe("Hello L"); doc.destroy();
  });
  it("replays the SAME intent after checkpoint, peer append and restart exactly once", () => {
    const doc = document("Hello"), update = transfer(doc, "Hello", "Hello L");
    Y.applyUpdate(doc, update);
    documentText(doc, "body").insert(documentText(doc, "body").length, " R");
    const restored = new Y.Doc(); Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
    let updates = 0; restored.on("update", () => updates++);
    Y.applyUpdate(restored, update); Y.applyUpdate(restored, update);
    expect(documentSnapshotFromYDoc(restored).content.body).toBe("Hello L R"); expect(updates).toBe(0);
    restored.destroy(); doc.destroy();
  });
  it("retains independently merged peer input without reminting the local insertion", () => {
    const doc = document("Hello R"), update = transfer(doc, "Hello", "Hello L");
    Y.applyUpdate(doc, update); const merged = documentSnapshotFromYDoc(doc);
    const reopened = new Y.Doc(); Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc)); Y.applyUpdate(reopened, update);
    expect(documentSnapshotFromYDoc(reopened)).toEqual(merged); expect(merged.content.body).toBe("Hello L R");
    reopened.destroy(); doc.destroy();
  });
  it("keeps a replacement and later peer append exactly once", () => {
    const doc = document("old"), update = transfer(doc, "old", "A"); Y.applyUpdate(doc, update);
    documentText(doc, "body").insert(1, "B"); Y.applyUpdate(doc, update);
    expect(documentSnapshotFromYDoc(doc).content.body).toBe("AB"); doc.destroy();
  });
  it("does not mint an update when local changes are already exactly present", () => {
    const doc = document("Hello L"); const update = transfer(doc, "Hello", "Hello L");
    let updates = 0; doc.on("update", () => updates++); Y.applyUpdate(doc, update);
    expect(updates).toBe(0); expect(update).toEqual(new Uint8Array([0, 0])); doc.destroy();
  });
  it("does not mint IDs for equal map values with different key order", () => {
    const base = snapshot("Hello"); base.content.fields = {first: 1, second: 2};
    const remote = structuredClone(base); remote.content.fields = {second: 2, first: 1};
    const doc = new Y.Doc(); applyDocumentSnapshot(doc, remote);
    expect(prepareHandoffUpdate(doc, base, base)).toEqual(new Uint8Array([0,0])); doc.destroy();
  });
  it("refuses divergent title values without mutating either owner", () => {
    const doc = document("Hello"); applyDocumentSnapshot(doc, snapshot("Hello", "Remote"));
    const before = Y.encodeStateAsUpdate(doc);
    expect(prepareHandoffUpdate(doc, snapshot("Hello"), snapshot("Hello", "Local"))).toBeNull();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before); doc.destroy();
  });
  it.each(["array", "asset", "template"] as const)("retains divergent %s changes without applying a guessed merge", field => {
    const base = snapshot("Hello"), local = structuredClone(base), remote = structuredClone(base);
    if (field === "array") {
      base.content.fields.rows = ["old"]; local.content.fields.rows = ["local"]; remote.content.fields.rows = ["remote"];
    } else if (field === "asset") {
      base.content.assets = [{ id: "image", kind: "image", src: "assets/original.png" }];
      local.content.assets = [{ id: "image", kind: "image", src: "assets/local.png" }];
      remote.content.assets = [{ id: "image", kind: "image", src: "assets/remote.png" }];
    } else {
      local.presentation.template.version = 2; remote.presentation.template.version = 3;
    }
    const doc = new Y.Doc(); applyDocumentSnapshot(doc, remote); const before = Y.encodeStateAsUpdate(doc);
    expect(prepareHandoffUpdate(doc, base, local)).toBeNull();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before); doc.destroy();
  });
});
