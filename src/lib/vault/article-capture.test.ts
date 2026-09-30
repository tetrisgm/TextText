import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { applyArticleCapture, articleSource } from "./article-capture";
const sourceURL = "https://example.com/article";
function note(body = sourceURL) {
  const document = emptyDocumentSnapshot({ id: "texttext.bookmark", version: 1 });
  document.content.title = "My chosen title";
  document.content.body = body;
  document.content.fields = { sourceUrl: sourceURL, commentary: "My notes", custom: "Keep" };
  return document;
}
const capture = { sourceURL, markdown: "# Captured article\n\nPublisher text.", capturedAt: "2026-09-30T12:00:00Z" };
describe("file-backed article capture", () => {
  it("enriches a saved link without altering title, annotations, assets, or presentation", () => {
    const base = note(); base.content.assets = [{ id: "photo", kind: "image", src: "assets/original.png" }];
    const { document, appliedToBody } = applyArticleCapture(base, base, capture);
    expect(appliedToBody).toBe(true);
    expect(document.content.body).toBe(capture.markdown);
    expect(document.content.fields).toMatchObject({ commentary: "My notes", custom: "Keep", capturedSourceBody: capture.markdown });
    expect(document.content.title).toBe(base.content.title);
    expect(document.content.assets).toEqual(base.content.assets);
    expect(document.presentation).toEqual(base.presentation);
    expect(base.content.body).toBe(sourceURL);
  });
  it("records the source alongside prose instead of overwriting it", () => {
    const base = note("My original commentary");
    const result = applyArticleCapture(base, base, capture);
    expect(result.appliedToBody).toBe(false);
    expect(result.document.content.body).toBe(base.content.body);
    expect(result.document.content.fields.capturedSourceBody).toBe(capture.markdown);
  });
  it("preserves human edits and look changes made during extraction", () => {
    const base = note(); const current = structuredClone(base);
    current.content.body = "Human concurrent edit";
    current.presentation.template = { id: "custom.reader", version: 2 };
    const result = applyArticleCapture(current, base, capture);
    expect(result.appliedToBody).toBe(false);
    expect(result.document.content.body).toBe(current.content.body);
    expect(result.document.presentation).toEqual(current.presentation);
  });
  it("refreshes untouched captured text but preserves subsequent annotations", () => {
    const base = applyArticleCapture(note(), note(), capture).document;
    const current = structuredClone(base); current.content.fields.commentary = "New note";
    const result = applyArticleCapture(current, base, { ...capture, markdown: "New source revision" });
    expect(result.appliedToBody).toBe(true);
    expect(result.document.content.fields.commentary).toBe("New note");
    current.content.body += "\nMy addition";
    expect(applyArticleCapture(current, base, capture).document.content.body).toBe(current.content.body);
  });
  it("fences changed sources and late callbacks", () => {
    const base = note(); const changed = note(); changed.content.fields.sourceUrl = "https://other.example/";
    expect(() => applyArticleCapture(changed, base, capture)).toThrow(/source link changed/);
    const newer = applyArticleCapture(base, base, capture).document;
    expect(() => applyArticleCapture(newer, base, capture)).toThrow(/newer capture/);
  });
  it("rejects unsafe links and oversized or invalid extraction results", () => {
    for (const url of ["javascript:alert(1)", "https://user:password@example.com", "file:///tmp/private"]) {
      const base = note(); base.content.fields.sourceUrl = url;
      expect(articleSource(base)).toBeNull();
    }
    expect(() => applyArticleCapture(note(), note(), { ...capture, markdown: "x".repeat(2_000_001) })).toThrow(/invalid/);
    expect(() => applyArticleCapture(note(), note(), { ...capture, capturedAt: "bad" })).toThrow(/invalid/);
  });
});
