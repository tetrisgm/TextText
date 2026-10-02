"use client";

import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { TemplateDefinition } from "@/lib/presentation/schema";

export function VaultStoryDisplay({ document, template, onEdit }: { document: DocumentSnapshot; template: TemplateDefinition; onEdit?: () => void }) {
  return <section className="vault-story-display" aria-label="Story reader">
    {onEdit && <div className="vault-story-display-actions"><button type="button" onClick={onEdit}>Edit story</button></div>}
    <DocumentRenderer document={document} template={template} />
  </section>;
}
