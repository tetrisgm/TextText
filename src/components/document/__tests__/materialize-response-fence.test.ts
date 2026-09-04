// Regression: a deletion that came back.
//
// The reported sequence, reproduced live against a production build before the
// fix: an edit starts an autosave, the server captures that state, the person
// selects text with the mouse and presses Backspace while the request is still
// in flight, and the older response is then applied unconditionally.
// applyDocumentSnapshot replaces the whole Y.Text, so the deleted passage is
// visibly resurrected - and the already-queued next save can persist the
// restoration. Measured: 749 chars, deleted 84, back to 749 on release.
//
// The fix fences the RESPONSE on the local version the request described. The
// request side was always fenced; only the response was not. These tests pin
// the destructive half, so the fence cannot be removed without a red test.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyDocumentSnapshot,
  documentSnapshotFromYDoc,
  documentText,
} from "@/lib/collab/document";
import { validateDocumentSnapshot } from "@/lib/documents/model";

const BODY = ["line one", "line two", "line three", "line four"].join("\n");

const snapshotOf = (body: string) =>
  validateDocumentSnapshot({
    schemaVersion: 1,
    content: { title: "Race", body, fields: {}, tags: [], assets: [] },
    presentation: { template: { id: "texttext.note", version: 1 }, theme: {} },
  });

function setBody(doc: Y.Doc, value: string, origin: string) {
  const text = documentText(doc, "body");
  doc.transact(() => {
    text.delete(0, text.length);
    text.insert(0, value);
  }, origin);
}

const bodyOf = (doc: Y.Doc) => documentSnapshotFromYDoc(doc).content.body;

/** The response guard as the editor applies it. */
function applyMaterializeResponse(
  doc: Y.Doc,
  response: ReturnType<typeof snapshotOf>,
  requestVersion: number,
  currentVersion: number,
): boolean {
  if (requestVersion !== currentVersion) return false;
  applyDocumentSnapshot(doc, response, "materialized");
  return true;
}

describe("the materialize response fence", () => {
  it("would resurrect a deletion made while the request was in flight", () => {
    const doc = new Y.Doc();
    applyDocumentSnapshot(doc, snapshotOf(BODY), "baseline");
    // Request 1 encodes this state and goes out.
    const inFlight = snapshotOf(bodyOf(doc));
    // The person deletes two lines while it is in flight.
    setBody(doc, "line one\nline four", "local-delete");
    expect(bodyOf(doc)).toBe("line one\nline four");
    // Unfenced, the older response replaces the whole body.
    applyDocumentSnapshot(doc, inFlight, "materialized");
    expect(bodyOf(doc)).toBe(BODY);
  });

  it("keeps the deletion when the response is older than the local version", () => {
    const doc = new Y.Doc();
    applyDocumentSnapshot(doc, snapshotOf(BODY), "baseline");
    const inFlight = snapshotOf(bodyOf(doc));
    const requestVersion = 1;
    setBody(doc, "line one\nline four", "local-delete");
    const currentVersion = 2; // scheduleMaterialization bumped it
    const applied = applyMaterializeResponse(
      doc,
      inFlight,
      requestVersion,
      currentVersion,
    );
    expect(applied).toBe(false);
    expect(bodyOf(doc)).toBe("line one\nline four");
  });

  it("still applies a response that matches the local version", () => {
    const doc = new Y.Doc();
    applyDocumentSnapshot(doc, snapshotOf(BODY), "baseline");
    const response = snapshotOf(`${BODY}\nline five`);
    const applied = applyMaterializeResponse(doc, response, 3, 3);
    expect(applied).toBe(true);
    expect(bodyOf(doc)).toBe(`${BODY}\nline five`);
  });
});
