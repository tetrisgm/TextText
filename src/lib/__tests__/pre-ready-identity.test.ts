import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyPreReadyTextOperations,
  capturePreReadyDocumentBaseline,
  capturePreReadyTextBaseline,
  preReadyTextOperations,
} from "@/lib/collab/pre-ready";
import { applyDocumentBaseline, documentText } from "@/lib/collab/document";
import { validateDocumentSnapshot } from "@/lib/documents/model";

function pair(text: string) {
  const a = new Y.Doc(), b = new Y.Doc();
  a.clientID = 101;
  b.clientID = 202;
  a.getText("t").insert(0, text);
  const baseline = capturePreReadyTextBaseline(a.getText("t"));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return { a, b, baseline };
}
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
}

it.each([0, 1, 2, 3])("preserves the actual peer insertion at repeated-text offset %i", (at) => {
  const { a, b, baseline } = pair("aaa");
  b.getText("t").insert(at, "a");
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  const target = a.getText("t");
  const operations = preReadyTextOperations("aaa", "aa", target.toString(), { baseline, target });
  expect(applyPreReadyTextOperations(target, operations, "local")).toBe(true);
  expect(target.toString()).toBe("aaa");
  // Delete all original identities on the peer before it learns the local edit.
  if (at < 3) b.getText("t").delete(at + 1, 3 - at);
  if (at) b.getText("t").delete(0, at);
  sync(a, b);
  expect([target.toString(), b.getText("t").toString()]).toEqual(["a", "a"]);
  a.destroy(); b.destroy();
});

it.each([true, false])("keeps same-visible peer replacements with gc=%s", (gc) => {
  const { a, b, baseline } = pair("abc");
  a.gc = b.gc = gc;
  b.getText("t").delete(1, 1);
  b.getText("t").insert(1, "b");
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  const target = a.getText("t");
  expect(preReadyTextOperations("abc", "ac", target.toString(), { baseline, target })).toEqual([]);
  sync(a, b);
  expect([target.toString(), b.getText("t").toString()]).toEqual(["abc", "abc"]);
  a.destroy(); b.destroy();
});

it.each([
  ["😀", "😁", "😁"],
  ["x😀y", "x😁y", "x😁y"],
  ["😀😁😀", "😁😎", "😁😎"],
  ["𐀀", "𐐀", "𐐀"], // shared low surrogate must not be trimmed either
])("keeps complete code points for %j -> %j", (base, local, expected) => {
  const { a, b, baseline } = pair(base);
  const target = a.getText("t");
  const operations = preReadyTextOperations(base, local, base, { baseline, target });
  const boundaries = new Set([0]);
  let offset = 0;
  for (const point of base) { offset += point.length; boundaries.add(offset); }
  for (const h of operations) {
    expect(boundaries.has(h.start)).toBe(true);
    expect(boundaries.has(h.end)).toBe(true);
  }
  applyPreReadyTextOperations(target, operations, "local");
  sync(a, b);
  expect([target.toString(), b.getText("t").toString()]).toEqual([expected, expected]);
  a.destroy(); b.destroy();
});

it("keeps a peer's whole emoji replacement when locally deleting the original", () => {
  const { a, b, baseline } = pair("😀");
  b.getText("t").delete(0, 2);
  b.getText("t").insert(0, "😁");
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  const target = a.getText("t");
  applyPreReadyTextOperations(target, preReadyTextOperations("😀", "", target.toString(), { baseline, target }), "local");
  sync(a, b);
  expect([target.toString(), b.getText("t").toString()]).toEqual(["😁", "😁"]);
  a.destroy(); b.destroy();
});

it.each([
  [0, 4, "XYZ"],
  [1, 2, "aXYZd"],
])("orders three collapsed insertions after deleting [%i, %i]", (at, count, expected) => {
  const { a, b, baseline } = pair("abcd");
  b.getText("t").delete(at, count);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  const target = a.getText("t");
  applyPreReadyTextOperations(target, preReadyTextOperations("abcd", "aXbYcZd", target.toString(), { baseline, target }), "local");
  sync(a, b);
  expect([target.toString(), b.getText("t").toString()]).toEqual([expected, expected]);
  a.destroy(); b.destroy();
});

it("does not confuse a top-level type name with shared character identities", () => {
  const { a, b, baseline } = pair("abc");
  const unrelated = new Y.Doc(); unrelated.clientID = 303;
  const target = unrelated.getText("t"); target.insert(0, "abc");
  expect(() => preReadyTextOperations("abc", "ac", "abc", { baseline, target })).toThrow("needs recovery");
  expect(target.toString()).toBe("abc");
  a.destroy(); b.destroy(); unrelated.destroy();
});

it("reconstructs the canonical startup identities without writing into the live document", () => {
  const snapshot = validateDocumentSnapshot({ schemaVersion: 1, content: { title: "Title", body: "aaa", fields: {}, tags: [], assets: [] }, presentation: { template: { id: "texttext.note", version: 1 }, theme: {} } });
  const baseline = capturePreReadyDocumentBaseline(snapshot, "post:7");
  const doc = new Y.Doc(); doc.clientID = 404;
  applyDocumentBaseline(doc, snapshot, "post:7");
  const target = documentText(doc, "body");
  target.insert(2, "a");
  applyPreReadyTextOperations(target, preReadyTextOperations("aaa", "aa", "aaaa", { baseline: baseline.body, target }), "local");
  expect(target.toString()).toBe("aaa");
  // The retained third character is the peer's ID, not the last startup ID.
  expect(capturePreReadyTextBaseline(target).keys[2]).not.toBe(baseline.body.keys[2]);
  doc.destroy();
});

it.each(["abc", "aaaa"])("returns recovery without applying any string-only hunk for %j", (remote) => {
  const { a, b } = pair(remote === "abc" ? "abc" : "aaa");
  const base = a.getText("t").toString();
  if (remote === "abc") { b.getText("t").delete(1, 1); b.getText("t").insert(1, "b"); }
  else b.getText("t").insert(2, "a");
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  const target = a.getText("t");
  const operations = preReadyTextOperations(base, remote === "abc" ? "ac!" : "aa!", remote);
  expect(applyPreReadyTextOperations(target, operations, "local")).toBe(false);
  expect(target.toString()).toBe(remote);
  a.destroy(); b.destroy();
});
