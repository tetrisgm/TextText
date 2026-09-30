import type { DocumentSnapshot } from "@/lib/documents/model";
export type ReaderHighlight = { id: string; quote: string; prefix: string; suffix: string; note: string; source: string };
export function readerHighlights(document: DocumentSnapshot): ReaderHighlight[] {
  const rows = document.content.fields.readerHighlights;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is ReaderHighlight => !!row && typeof row === "object" &&
    ["id", "quote", "prefix", "suffix", "note", "source"].every((key) => typeof row[key] === "string"));
}
/** A quote must have one unambiguous anchor. Never silently move a highlight
 * onto another occurrence when its original surrounding text changes. */
export function locateHighlight(text: string, highlight: ReaderHighlight): { start: number; end: number } | null {
  if (!highlight.quote) return null;
  let found: number | undefined;
  for (let index = text.indexOf(highlight.quote); index >= 0; index = text.indexOf(highlight.quote, index + 1)) {
    if (!text.slice(0, index).endsWith(highlight.prefix) || !text.slice(index + highlight.quote.length).startsWith(highlight.suffix)) continue;
    if (found !== undefined) return null;
    found = index;
  }
  return found === undefined ? null : { start: found, end: found + highlight.quote.length };
}
export function addReaderHighlight(document: DocumentSnapshot, highlight: ReaderHighlight): DocumentSnapshot {
  const rows = readerHighlights(document);
  if (rows.length >= 500) throw new Error("This document already has 500 highlights.");
  if (!highlight.quote.trim() || highlight.quote.length > 2000 || highlight.prefix.length > 64 || highlight.suffix.length > 64) throw new Error("Select up to 2,000 characters in this article.");
  if (rows.some((row) => row.quote === highlight.quote && row.prefix === highlight.prefix && row.suffix === highlight.suffix)) return document;
  return { ...document, content: { ...document.content, fields: { ...document.content.fields, readerHighlights: [...rows, highlight] } } };
}
