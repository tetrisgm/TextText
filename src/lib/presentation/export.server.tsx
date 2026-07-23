import { renderToStaticMarkup } from "react-dom/server";
import { DocumentRenderer, type DocumentRenderMetadata } from "@/components/document/DocumentRenderer";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { TemplateDefinition } from "@/lib/presentation/schema";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function compileDocumentHtml({
  document,
  template,
  metadata,
}: {
  document: DocumentSnapshot;
  template: TemplateDefinition;
  metadata?: DocumentRenderMetadata;
}): string {
  const markup = renderToStaticMarkup(
    <DocumentRenderer document={document} template={template} metadata={metadata} />,
  );
  const title = document.content.title.trim() || "Untitled";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body>${markup}</body></html>`;
}
