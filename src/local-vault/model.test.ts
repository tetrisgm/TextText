import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { readDocument, writePayload } from "./model";
import type { VaultFile } from "./bridge";
const file: VaultFile = { path: "Notes/Test.textpack", hash: "before", markdown: '---\ntextTextId: "d6090b67-e3bb-46a3-9d34-76061bcb1dbb"\ntitle: "Test"\n---\n\nold' };
function snapshot() {
  const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
  document.content.title = "Test";
  document.content.body = "old";
  return document;
}
describe("local vault document projection", () => {
  it("reads an agent's raw markdown edit over stale structured text", () => {
    const document = snapshot();
    document.content.fields.rating = 4;
    const read = readDocument({ ...file, markdown: file.markdown.replace(/old$/, "agent changed this"), documentJSON: JSON.stringify(document) });
    expect(read.content.body).toBe("agent changed this");
    expect(read.content.fields.rating).toBe(4);
  });
  it("preserves file identity and exact body whitespace on a write/read round trip", () => {
    const document = snapshot();
    document.content.title = "A renamed note";
    document.content.body = "\n\nA body  \n\n";
    document.content.subtitle = "Description";
    const payload = writePayload(file, document);
    expect(payload.markdown).toContain('textTextId: "d6090b67-e3bb-46a3-9d34-76061bcb1dbb"');
    expect(readDocument(payload)).toEqual(document);
  });
  it("does not resurrect cleared mutable metadata from the old header", () => {
    const previous = { ...file, markdown: file.markdown.replace('title: "Test"', 'title: "Test"\ntags: ["old"]\ncover: "https://example.com/old.png"') };
    const document = snapshot();
    const next = readDocument(writePayload(previous, document));
    expect(next.content.tags).toEqual([]);
    expect(next.content.fields.cover).toBeUndefined();
  });
  it("rejects malformed canonical JSON instead of overwriting it with a blank note", () => {
    expect(() => readDocument({ ...file, documentJSON: '{"bad":true}' })).toThrow();
  });
});

describe("observed file representation changes", () => {
  it("accepts a JSON-only agent body edit with an observed baseline", () => {
    const before = snapshot();
    const previous = { ...file, documentJSON: JSON.stringify(before) };
    const after = structuredClone(before); after.content.body = "JSON agent edit";
    expect(readDocument({ ...previous, documentJSON: JSON.stringify(after) }, previous).content.body).toBe("JSON agent edit");
  });
  it("preserves an earlier markdown edit when a later JSON-only field changes", () => {
    const before = snapshot();
    const previous = { ...file, markdown: file.markdown.replace(/old$/, "Markdown agent edit"), documentJSON: JSON.stringify(before) };
    const after = structuredClone(before); after.content.fields.rating = 5;
    const result = readDocument({ ...previous, documentJSON: JSON.stringify(after) }, previous);
    expect(result.content.body).toBe("Markdown agent edit");
    expect(result.content.fields.rating).toBe(5);
  });
  it("surfaces competing body edits in both representations", () => {
    const before = snapshot();
    const previous = { ...file, documentJSON: JSON.stringify(before) };
    const after = structuredClone(before); after.content.body = "JSON agent edit";
    expect(() => readDocument({ ...previous, markdown: file.markdown.replace(/old$/, "Markdown agent edit"), documentJSON: JSON.stringify(after) }, previous)).toThrow("competing edits");
  });
});
