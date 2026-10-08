import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { applyDocumentMutation, applyDocumentSnapshot, documentSnapshotFromYDoc } from "../document";
import { emptyDocumentSnapshot } from "@/lib/documents/model";

function fixture() {
  const snapshot = emptyDocumentSnapshot();
  snapshot.content.body = "Keep body";
  snapshot.content.assets = [
    { id: "one", kind: "image", src: "assets/one.jpg", caption: "Keep caption", summary: "Old", tags: ["old"] },
    { id: "two", kind: "image", src: "assets/two.jpg", summary: "Keep neighbor" },
  ];
  const doc = new Y.Doc(); applyDocumentSnapshot(doc, snapshot); return { doc, snapshot };
}
describe("targeted image metadata transaction", () => {
  it("updates one image and replays once, preserving every other field and neighbor", () => {
    const { doc, snapshot } = fixture();
    const mutation = { assetMetadata: { id: "one", summary: "Generated", tags: ["blue", "light"] }, operationId: "agent-photo-1" };
    expect(applyDocumentMutation(doc, mutation)).toBe(true);
    expect(applyDocumentMutation(doc, mutation)).toBe(false);
    expect(documentSnapshotFromYDoc(doc)).toEqual({ ...snapshot, content: { ...snapshot.content, assets: [{ ...snapshot.content.assets[0], summary: "Generated", tags: ["blue", "light"] }, snapshot.content.assets[1]] } });
    doc.destroy();
  });
  it("clears summary without changing tags or original image references", () => {
    const { doc } = fixture(); applyDocumentMutation(doc, { assetMetadata: { id: "one", summary: null } });
    expect(documentSnapshotFromYDoc(doc).content.assets[0]).toEqual({ id: "one", kind: "image", src: "assets/one.jpg", caption: "Keep caption", tags: ["old"] }); doc.destroy();
  });
  it.each(["missing", "duplicate", "not-image", "oversized", "replace"])("refuses %s before any mutation or replay receipt", kind => {
    const { doc, snapshot } = fixture();
    if (kind === "duplicate") snapshot.content.assets.push({ ...snapshot.content.assets[0] });
    if (kind === "not-image") snapshot.content.assets[0].kind = "file";
    applyDocumentSnapshot(doc, snapshot);
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => applyDocumentMutation(doc, { title: "Must not change", operationId: "refused", assetMetadata: { id: kind === "missing" ? "gone" : "one", summary: kind === "oversized" ? "x".repeat(4001) : "new" }, ...(kind === "replace" ? { assets: [] } : {}) })).toThrow();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before); doc.destroy();
  });
});
