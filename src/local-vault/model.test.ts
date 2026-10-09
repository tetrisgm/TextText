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
  it("writes the item kind that matches a built-in template", () => {
    for (const [id, kind] of [["texttext.article", "article"], ["texttext.bookmark", "bookmark"], ["texttext.gallery", "media_post"]] as const) {
      const document = emptyDocumentSnapshot({ id, version: 1 });
      document.content.title = "New item";
      const payload = writePayload(file, document);
      expect(payload.markdown).toContain(`kind: "${kind}"`);
      expect(readDocument(payload).presentation.template.id).toBe(id);
    }
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

describe("external file changes with projection provenance", () => {
  /** A file as the app's last coherent save left it: both entries plus the stamp. */
  function stamped(body = "one\ntwo\nthree") {
    const document = snapshot();
    document.content.body = body;
    document.content.fields.rating = 3;
    const payload = writePayload({ ...file, documentJSON: JSON.stringify(snapshot()) }, document);
    expect(payload.projectionJSON).toBeTruthy();
    return { saved: { ...file, ...payload } as VaultFile, document };
  }
  const withJSON = (saved: VaultFile, mutate: (document: ReturnType<typeof snapshot>) => void) => {
    const document = JSON.parse(saved.documentJSON!);
    mutate(document);
    return { ...saved, documentJSON: JSON.stringify(document) };
  };
  const withMarkdown = (saved: VaultFile, body: string) => ({ ...saved, markdown: saved.markdown.replace(/one\ntwo\nthree$/, body) });

  it("reads a JSON-only edit over stale Markdown without a previous file", () => {
    const { saved } = stamped();
    const edited = withJSON(saved, (document) => { document.content.body = "JSON agent edit"; });
    expect(readDocument(edited).content.body).toBe("JSON agent edit");
    expect(readDocument(edited, saved).content.body).toBe("JSON agent edit");
  });

  it("keeps a JSON-only deletion that stale Markdown still contains", () => {
    const { saved } = stamped();
    const edited = withJSON(saved, (document) => { document.content.body = "one\nthree"; });
    expect(readDocument(edited).content.body).toBe("one\nthree");
  });

  it("reads a Markdown-only edit over the stamped document and keeps JSON-only fields", () => {
    const { saved } = stamped();
    const edited = withMarkdown(saved, "one\ntwo\nthree\nCLI");
    for (const previous of [undefined, saved]) {
      const read = readDocument(edited, previous);
      expect(read.content.body).toBe("one\ntwo\nthree\nCLI");
      expect(read.content.fields.rating).toBe(3);
    }
    expect(readDocument(withMarkdown(saved, "one\nthree")).content.body).toBe("one\nthree");
  });

  it("merges separate JSON and Markdown edits made after the same save", () => {
    const { saved } = stamped();
    const edited = withJSON(withMarkdown(saved, "one\ntwo\nthree\nCLI"), (document) => { document.content.fields.rating = 5; });
    const read = readDocument(edited);
    expect(read.content.body).toBe("one\ntwo\nthree\nCLI");
    expect(read.content.fields.rating).toBe(5);
    const bodies = withJSON(withMarkdown(saved, "ONE\ntwo\nthree"), (document) => { document.content.body = "one\ntwo\nTHREE"; });
    expect(readDocument(bodies).content.body).toBe("ONE\ntwo\nTHREE");
  });

  it("surfaces a proved conflict even when the previous file would have hidden it", () => {
    const { saved } = stamped();
    const conflicting = withJSON(withMarkdown(saved, "one\nMD\nthree"), (document) => { document.content.body = "one\nJSON\nthree"; });
    expect(() => readDocument(conflicting)).toThrow("competing edits");
    expect(() => readDocument(conflicting, saved)).toThrow("competing edits");
    // A previous file that already carried the same Markdown would have made the
    // JSON look like the only change; the stamp proves otherwise.
    const misleadingPrevious = { ...saved, markdown: conflicting.markdown, projectionJSON: null };
    expect(() => readDocument(conflicting, misleadingPrevious)).toThrow("competing edits");
  });

  it("ignores a stamp for another item and keeps the legacy comparison", () => {
    const { saved } = stamped();
    const foreign = { ...saved, projectionJSON: saved.projectionJSON!.replace(/"itemId":"[^"]+"/, '"itemId":"other"') };
    expect(foreign.projectionJSON).not.toBe(saved.projectionJSON);
    const edited = withJSON(foreign, (document) => { document.content.body = "JSON agent edit"; });
    // Without provenance and without a previous file, Markdown still overlays JSON.
    expect(readDocument(edited).content.body).toBe("one\ntwo\nthree");
    expect(readDocument(edited, foreign).content.body).toBe("JSON agent edit");
  });
});
