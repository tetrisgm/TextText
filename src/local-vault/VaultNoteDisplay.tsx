"use client";

import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { TemplateDefinition } from "@/lib/presentation/schema";

export function VaultNoteDisplay({ document, template, onEdit }: { document: DocumentSnapshot; template: TemplateDefinition; onEdit?: () => void }) {
  return <section className="vault-note-display" aria-label="Note card" tabIndex={onEdit ? 0 : undefined}
    onClick={onEdit ? (event) => {
      if (event.target instanceof Element && !event.target.closest("a, button, input, textarea, [contenteditable]")) event.currentTarget.focus();
    } : undefined}
    onKeyDown={onEdit ? (event) => {
      if (event.target === event.currentTarget && event.key === "Enter") { event.preventDefault(); onEdit(); }
    } : undefined}>
    {onEdit && <div className="vault-note-display-actions"><button type="button" onClick={onEdit} aria-label="Edit card" title="Edit card"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4Z"/></svg></button></div>}
    <DocumentRenderer document={document} template={template} />
    {document.content.tags.length > 0 && <div className="vault-note-display-tags">{document.content.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
  </section>;
}
