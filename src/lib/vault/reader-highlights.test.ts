import { expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { addReaderHighlight, locateHighlight, readerHighlights } from "./reader-highlights";
const highlight = { id: "one", quote: "important", prefix: "An ", suffix: " detail.", note: "", source: "https://example.com" };
it("anchors the selected occurrence and refuses ambiguous or changed context", () => {
  expect(locateHighlight("An important detail.", highlight)).toEqual({ start: 3, end: 12 });
  expect(locateHighlight("An important detail. An important detail.", highlight)).toBeNull();
  expect(locateHighlight("A different important detail.", highlight)).toBeNull();
});
it("keeps authored content and fields intact while saving and deduplicating excerpts", () => {
  const base = emptyDocumentSnapshot({ id: "texttext.bookmark", version: 1 });
  base.content.body = "An important detail."; base.content.fields.commentary = "My note";
  const updated = addReaderHighlight(base, highlight);
  expect(updated.content.body).toBe(base.content.body);
  expect(updated.content.fields.commentary).toBe("My note");
  expect(readerHighlights(updated)).toEqual([highlight]);
  expect(readerHighlights(addReaderHighlight(updated, { ...highlight, id: "duplicate" }))).toHaveLength(1);
  expect(readerHighlights(base)).toEqual([]);
});
it("bounds quote size and skips malformed external rows", () => {
  const base = emptyDocumentSnapshot({ id: "texttext.bookmark", version: 1 });
  base.content.fields.readerHighlights = ["not a row"];
  expect(readerHighlights(base)).toEqual([]);
  expect(() => addReaderHighlight(base, { ...highlight, quote: "x".repeat(2001) })).toThrow(/2,000/);
});
