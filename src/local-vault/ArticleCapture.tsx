import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { applyArticleCapture, articleSource, isLinkPlaceholder, type ArticleCapture as CaptureResult } from "@/lib/vault/article-capture";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { vaultRequest } from "./bridge";

export function ArticleCapture({ document, readCurrent, update, beforeCapture }: {
  document: DocumentSnapshot;
  readCurrent: () => DocumentSnapshot;
  update: (transform: (current: DocumentSnapshot) => DocumentSnapshot) => void;
  beforeCapture: () => Promise<boolean>;
}) {
  const source = articleSource(document);
  const active = useRef(true), running = useRef(false), attempted = useRef(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");

  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const capture = useCallback(async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setNotice("");
    let base: DocumentSnapshot | undefined;
    try {
      if (!await beforeCapture() || !active.current) return;
      base = structuredClone(readCurrent());
      const sourceURL = articleSource(base);
      if (!sourceURL) throw new Error("This item no longer has a source link.");
      const result = await vaultRequest<CaptureResult>("extractArticle", { sourceURL });
      if (!active.current) return;
      let applied = false;
      update((current) => { const merged = applyArticleCapture(current, base!, result); applied = merged.appliedToBody; return merged.document; });
      setNotice(applied ? "Article captured. Your original link is retained." : "Source captured separately. Your writing is unchanged.");
    } catch (error) {
      if (!active.current) return;
      // Persist the failure so reopening does not start an automatic retry loop.
      if (base && articleSource(readCurrent()) === articleSource(base) &&
        readCurrent().content.fields.capturedAt === base.content.fields.capturedAt &&
        readCurrent().content.fields.capturedSourceBody === base.content.fields.capturedSourceBody) {
        try { update((current) => ({ ...current, content: { ...current.content, fields: { ...current.content.fields, captureStatus: "failed" } } })); } catch { /* Keep unresolved file conflicts intact. */ }
      }
      setNotice(error instanceof Error ? error.message : "Could not capture the article. Your link is saved.");
    } finally { running.current = false; if (active.current) setBusy(false); }
  }, [beforeCapture, readCurrent, update]);
  useEffect(() => {
    let cancelled = false;
    // New links are already durable before this component mounts. Extraction
    // runs once when opened and never polls or blocks writing.
    void Promise.resolve().then(() => {
      const current = readCurrent();
      if (!cancelled && !attempted.current && source && !current.content.fields.captureStatus && isLinkPlaceholder(current.content.body, source)) {
        attempted.current = true; void capture();
      }
    });
    return () => { cancelled = true; };
  }, [source, capture, readCurrent]);
  if (!source) return null;
  const captured = document.content.fields.capturedSourceBody;
  const sourceTemplate = BUILTIN_TEMPLATES.find((template) => template.id === "texttext.article")!;
  return <aside className="vault-article" aria-label="Article source">
    <div><a href={source} target="_blank" rel="noopener noreferrer">Open original ↗</a>
      <button disabled={busy} onClick={() => void capture()}>{busy ? "Reading article…" : captured ? "Refresh article" : "Read article"}</button></div>
    {(notice || document.content.fields.captureStatus === "failed") && <p role="status">{notice || "The article could not be captured. Your link is saved; retry when ready."}</p>}
    {typeof captured === "string" && captured !== document.content.body && <details><summary>Captured source</summary><DocumentRenderer documentId="vault-captured-source" document={{ ...document, content: { ...document.content, body: captured, fields: { sourceUrl: source } }, presentation: { ...document.presentation, template: { id: sourceTemplate.id, version: sourceTemplate.version } } }} template={sourceTemplate} /></details>}
    <details><summary>Your notes</summary><textarea aria-label="Your article notes" value={String(document.content.fields.commentary ?? "")} onChange={(event) => {
      const value = event.target.value;
      update((current) => ({ ...current, content: { ...current.content, fields: { ...current.content.fields, commentary: value } } }));
    }} /></details>
  </aside>;
}
