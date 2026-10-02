"use client";

import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { TemplateDefinition } from "@/lib/presentation/schema";

export function VaultStoryDisplay({ document, template, onEdit }: { document: DocumentSnapshot; template: TemplateDefinition; onEdit?: () => void }) {
  const author = typeof document.content.fields.author === "string" ? document.content.fields.author.trim() : "";
  const words = document.content.body.trim().split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(words / 250));
  return <section className="vault-story-display" aria-label="Story reader">
    {onEdit && <div className="vault-story-display-actions"><button type="button" onClick={onEdit}>Edit story</button></div>}
    <DocumentRenderer document={document} template={template} slots={{ byline: <div className="vault-story-byline">{author && <><span className="vault-story-avatar" aria-hidden="true">{author.slice(0, 1).toUpperCase()}</span><span>{author}</span><span aria-hidden="true">·</span></>}<span>{readingTime} min read</span></div> }} />
  </section>;
}
