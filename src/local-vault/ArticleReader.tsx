import { useEffect, useRef, useState } from "react";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { addReaderHighlight, locateHighlight, readerHighlights, type ReaderHighlight } from "@/lib/vault/reader-highlights";

export function ArticleReader({ document, template, update }: {
  document: DocumentSnapshot; template: TemplateDefinition;
  update: (transform: (document: DocumentSnapshot) => DocumentSnapshot) => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const selected = useRef<ReaderHighlight | null>(null);
  const [selectionAvailable, setSelectionAvailable] = useState(false);
  const [error, setError] = useState("");
  const highlights = readerHighlights(document);
  useEffect(() => {
    const root = content.current;
    if (!root) return;
    const observe = () => {
      const selection = window.getSelection();
      selected.current = null;
      if (selection?.rangeCount && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        if (root.contains(range.startContainer) && root.contains(range.endContainer)) {
          const quote = range.toString();
          if (quote.trim() && quote.length <= 2000) {
            const before = range.cloneRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
            const start = before.toString().length;
            const text = root.textContent ?? "";
            selected.current = { id: crypto.randomUUID(), quote, prefix: text.slice(Math.max(0, start - 64), start), suffix: text.slice(start + quote.length, start + quote.length + 64), note: "", source: String(document.content.fields.capturedAt ?? document.content.fields.sourceUrl ?? "") };
          }
        }
      }
      setSelectionAvailable(!!selected.current);
    };
    globalThis.document.addEventListener("selectionchange", observe);
    // Optional browser highlight painting. The durable excerpt list works on
    // engines without this API as well; no DOM mutation of React's content.
    const registry = (globalThis.CSS as typeof CSS & { highlights?: Map<string, unknown> })?.highlights;
    const Constructor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (registry && Constructor && (root.textContent?.length ?? 0) <= 200_000) {
      const text = root.textContent ?? "";
      const walker = globalThis.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes: { node: Node; start: number; end: number }[] = [];
      let offset = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) { const start = offset; offset += node.textContent?.length ?? 0; nodes.push({ node, start, end: offset }); }
      const ranges: Range[] = [];
      for (const highlight of readerHighlights(document)) {
        const match = locateHighlight(text, highlight);
        if (!match) continue;
        const first = nodes.find((entry) => entry.end > match.start), last = nodes.find((entry) => entry.end >= match.end);
        if (!first || !last) continue;
        const range = globalThis.document.createRange(); range.setStart(first.node, match.start - first.start); range.setEnd(last.node, match.end - last.start); ranges.push(range);
      }
      registry.set("texttext-reader", new Constructor(...ranges));
    }
    return () => { globalThis.document.removeEventListener("selectionchange", observe); registry?.delete("texttext-reader"); };
  }, [document]);
  return <section className="vault-reading" aria-label="Article reader">
    <div className="vault-reader-tools"><button disabled={!selectionAvailable} onMouseDown={(event) => event.preventDefault()} onClick={() => {
      if (!selected.current) return;
      const highlight = selected.current;
      try { update((current) => addReaderHighlight(current, highlight)); setError(""); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not save the highlight."); }
    }}>Highlight selection</button><span>Select text to keep a cited excerpt.</span></div>
    {error && <p role="alert">{error}</p>}
    <div ref={content}><DocumentRenderer documentId="vault-reader" document={document} template={template} /></div>
    {!!highlights.length && <details className="vault-highlights" open><summary>Highlights ({highlights.length})</summary>{highlights.map((highlight) => <div key={highlight.id}>
      <blockquote>{highlight.quote}</blockquote><label>Note about this highlight<textarea maxLength={20_000} value={highlight.note} onChange={(event) => {
        const note = event.target.value;
        update((current) => ({ ...current, content: { ...current.content, fields: { ...current.content.fields, readerHighlights: readerHighlights(current).map((row) => row.id === highlight.id ? { ...row, note } : row) } } }));
      }} /></label><button onClick={() => update((current) => ({ ...current, content: { ...current.content, fields: { ...current.content.fields, readerHighlights: readerHighlights(current).filter((row) => row.id !== highlight.id) } } }))}>Remove highlight</button>
    </div>)}</details>}
  </section>;
}
