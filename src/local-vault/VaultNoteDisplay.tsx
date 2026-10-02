"use client";

import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { TemplateDefinition } from "@/lib/presentation/schema";

export function VaultNoteDisplay({ document, template, onEdit }: { document: DocumentSnapshot; template: TemplateDefinition; onEdit?: () => void }) {
  return <section className="vault-note-display" aria-label="Note card">
    {onEdit && <div className="vault-note-display-actions"><button type="button" onClick={onEdit}>Edit card</button></div>}
    <DocumentRenderer document={document} template={template} />
    {document.content.tags.length > 0 && <div className="vault-note-display-tags">{document.content.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
  </section>;
}
