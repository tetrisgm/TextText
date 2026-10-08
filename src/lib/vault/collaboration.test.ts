import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { getBuiltinTemplate } from "@/lib/presentation/templates";
import { documentText, documentFields, documentTheme, documentPresentation } from "@/lib/collab/document";
import { openPack } from "@/local-vault/pack";
import { readDocument } from "@/local-vault/model";
import { seedVaultCollaboration, applyVaultCollaboration, MAX_VAULT_COLLABORATION_BYTES } from "./collaboration";

function fixture() {
  const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
  document.content.title = "Shared note";
  document.content.body = "Hello";
  const entries = unzipSync(buildTextpack("Shared", { document, markdown: '---\ntextTextId: item-1\ntitle: "Shared note"\n---\n\nHello' }));
  entries["Shared.textbundle/template.json"] = strToU8(JSON.stringify(getBuiltinTemplate("texttext.note", 1), null, 2));
  entries["Shared.textbundle/assets/picture.bin"] = new Uint8Array([0, 255, 33]);
  entries["Shared.textbundle/opaque.dat"] = new Uint8Array([4, 7, 9]);
  return zipSync(entries);
}
const encode = (value: Uint8Array) => Buffer.from(value).toString("base64");
function client(update: string) { const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(update, "base64")); return doc; }
function mutation(doc: Y.Doc, change: () => void) {
  const vector = Y.encodeStateVector(doc);
  change();
  return encode(Y.encodeStateAsUpdate(doc, vector));
}

describe("file pack full-document collaboration", () => {
  it("seeds JSON-safe optional image fields and reads older valid undefined omissions", () => {
    const entries = unzipSync(fixture());
    const document = emptyDocumentSnapshot();
    document.content.title = "Shared note"; document.content.body = "Hello";
    document.content.assets = [{ id: "photo", kind: "image", src: "assets/photo.png", caption: undefined, poster: undefined }];
    entries["Shared.textbundle/document.json"] = strToU8(JSON.stringify(document));
    const bytes = zipSync(entries), state = seedVaultCollaboration(bytes, "item-1", 1), doc = client(state.update);
    try {
      const assets = doc.getMap("document").get("assets") as Y.Array<Record<string, unknown>>;
      expect(Object.values(assets.get(0))).not.toContain(undefined);
      const legacy = { ...assets.get(0), caption: undefined, poster: undefined };
      assets.delete(0, 1); assets.insert(0, [legacy]);
      const retained = { ...state, update: encode(Y.encodeStateAsUpdate(doc)) };
      expect(() => applyVaultCollaboration(retained, bytes, ["AAA="])).not.toThrow();
      assets.delete(0, 1); assets.insert(0, [{ ...legacy, unknown: undefined }]);
      expect(() => applyVaultCollaboration({ ...state, update: encode(Y.encodeStateAsUpdate(doc)) }, bytes, ["AAA="])).toThrow();
      assets.delete(0, 1); assets.insert(0, [{ ...legacy, id: undefined }]);
      expect(() => applyVaultCollaboration({ ...state, update: encode(Y.encodeStateAsUpdate(doc)) }, bytes, ["AAA="])).toThrow();
    } finally { doc.destroy(); }
  });
  it("merges concurrent text, fields and presentation from one canonical baseline and keeps opaque bytes", () => {
    const bytes = fixture(), initial = seedVaultCollaboration(bytes, "item-1", 1);
    expect(seedVaultCollaboration(bytes, "item-1", 1)).toEqual(initial);
    const alice = client(initial.update), bob = client(initial.update);
    try {
      const a = mutation(alice, () => { documentText(alice, "body").insert(5, " Alice"); documentFields(alice).set("topic", "Notes"); });
      const b = mutation(bob, () => { documentText(bob, "body").insert(0, "Bob "); documentTheme(bob).set("accent", "#336699"); documentFields(bob).set("author", "Bob"); });
      const first = applyVaultCollaboration(initial, bytes, [a]);
      const final = applyVaultCollaboration(first.state, first.bytes, [b]);
      const reversed = applyVaultCollaboration(initial, bytes, [b, a]);
      expect(final.bytes).toEqual(reversed.bytes);
      const snapshot = readDocument(openPack(final.bytes, "Note.textpack", final.state.revision).file);
      expect(snapshot.content.body).toBe("Bob Hello Alice");
      expect(snapshot.content.fields.topic).toBe("Notes");
      expect(snapshot.presentation.theme.accent).toBe("#336699");
      const originalEntries = unzipSync(bytes), finalEntries = unzipSync(final.bytes);
      for (const name of ["assets/picture.bin", "opaque.dat", "info.json", "template.json"]) expect(finalEntries[`Shared.textbundle/${name}`]).toEqual(originalEntries[`Shared.textbundle/${name}`]);
      const replay = applyVaultCollaboration(final.state, final.bytes, [a, b]);
      expect(replay.bytes).toEqual(final.bytes);
      expect(replay.state.seq).toBe(final.state.seq + 1);
      Y.applyUpdate(alice, Buffer.from(final.state.update, "base64"));
      Y.applyUpdate(bob, Buffer.from(final.state.update, "base64"));
      expect(documentText(alice, "body").toString()).toBe(documentText(bob, "body").toString());
    } finally { alice.destroy(); bob.destroy(); }
  });

  it("rejects malformed, noncanonical, oversized, excessive and missing-dependency updates", () => {
    const bytes = fixture(), initial = seedVaultCollaboration(bytes, "item-1", 1), doc = client(initial.update);
    try {
      const first = mutation(doc, () => documentText(doc, "body").insert(5, " first"));
      const dependent = mutation(doc, () => documentText(doc, "body").insert(11, " dependent"));
      const pendingDelete = mutation(doc, () => documentText(doc, "body").delete(5, 1));
      for (const updates of [["!!!="], ["AA=="], [first + "\n"], ["A".repeat(512 * 1024 + 4)], Array(65).fill(first), [dependent], [pendingDelete], []]) {
        expect(() => applyVaultCollaboration(initial, bytes, updates)).toThrow();
      }
      expect(() => applyVaultCollaboration(initial, bytes, [dependent, first])).not.toThrow();
      expect(() => applyVaultCollaboration({ ...initial, revision: "0".repeat(64) }, bytes, [first])).toThrow();
      expect(() => seedVaultCollaboration(bytes, "other-id", 1)).toThrow();
      expect(() => seedVaultCollaboration(bytes, "item-1", 0)).toThrow();
      expect(() => applyVaultCollaboration({ ...initial, update: Buffer.alloc(MAX_VAULT_COLLABORATION_BYTES + 1).toString("base64") }, bytes, [first])).toThrow();
      const oversized = unzipSync(bytes);
      const markdown = '---\ntextTextId: item-1\n---\n\n' + "x".repeat(MAX_VAULT_COLLABORATION_BYTES);
      oversized["Shared.textbundle/text.md"] = strToU8(markdown);
      expect(() => seedVaultCollaboration(zipSync(oversized), "item-1", 1)).toThrow();
    } finally { doc.destroy(); }
  });

  it("rejects unknown roots, unsupported embedded Y values and missing template definitions", () => {
    const bytes = fixture(), initial = seedVaultCollaboration(bytes, "item-1", 1);
    const cases = [
      (doc: Y.Doc) => doc.getMap("other").set("secret", "ignored"),
      (doc: Y.Doc) => documentFields(doc).set("nested", new Y.Text("hidden")),
      (doc: Y.Doc) => doc.getMap("document").set("extra", "ignored"),
      (doc: Y.Doc) => documentText(doc, "body").setAttribute("hidden", true),
      (doc: Y.Doc) => documentText(doc, "body").insertEmbed(0, { hidden: true }),
      (doc: Y.Doc) => documentPresentation(doc).set("templateId", "texttext.gallery"),
    ];
    for (const change of cases) {
      const doc = client(initial.update);
      try { const update = mutation(doc, () => change(doc)); expect(() => applyVaultCollaboration(initial, bytes, [update])).toThrow(); }
      finally { doc.destroy(); }
    }
  });
});
