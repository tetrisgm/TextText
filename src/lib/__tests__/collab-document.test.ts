import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  applyDocumentBaseline,
  documentSnapshotFromYDoc,
  encodeDocumentBaseline,
} from "@/lib/collab/document";
import type { DocumentSnapshot } from "@/lib/documents/model";

const snapshot: DocumentSnapshot = {
  schemaVersion: 1,
  content: {
    title: "Shared draft",
    subtitle: "One document",
    body: "A body everyone can edit.",
    fields: { cover: "/asset/cover.jpg", rating: 5 },
    tags: ["collaboration"],
    assets: [{ id: "cover", kind: "image", src: "/asset/cover.jpg" }],
  },
  presentation: {
    template: { id: "texttext.article", version: 1 },
    theme: { accent: "#0071e3", measure: "wide" },
  },
};

describe("canonical collaboration document", () => {
  it("encodes a deterministic full-document baseline", () => {
    expect(Array.from(encodeDocumentBaseline(snapshot, "post:7"))).toEqual(
      Array.from(encodeDocumentBaseline(snapshot, "post:7")),
    );
  });

  it("round-trips content, fields, assets, and presentation", () => {
    const doc = new Y.Doc();
    applyDocumentBaseline(doc, snapshot, "post:7");
    expect(documentSnapshotFromYDoc(doc)).toEqual(snapshot);
    doc.destroy();
  });
});
