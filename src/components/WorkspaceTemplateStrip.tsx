"use client";

// The in-app face of the template catalog, in the spirit of the Pages and
// Keynote template choosers: a strip of live miniatures right where items
// get created. Each card is the template's real example rendered by the
// engine; choosing one creates a fresh draft in that shape and opens it.

import {
  DocumentEngineStyles,
  DocumentRenderer,
} from "@/components/document/DocumentRenderer";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { exemplarFor } from "@/lib/presentation/exemplars";
import {
  BUILTIN_TEMPLATES,
  TEMPLATE_CATALOG,
} from "@/lib/presentation/templates";

export function WorkspaceTemplateStrip() {
  const byId = new Map(
    BUILTIN_TEMPLATES.map((template) => [template.id, template]),
  );
  return (
    <section className="workspace-template-strip" aria-label="Start with a look">
      <header>
        <h2>Start with a look</h2>
        <a href="/templates">Browse all</a>
      </header>
      <DocumentEngineStyles />
      <div className="workspace-template-strip-cards">
        {TEMPLATE_CATALOG.map((entry) => {
          const template = byId.get(entry.id);
          if (!template) return null;
          const exemplar = exemplarFor(template.id);
          const slug = template.id.replace(/^texttext\./, "");
          const document = validateDocumentSnapshot({
            schemaVersion: 1,
            content: {
              title: exemplar?.title ?? template.name,
              body: exemplar?.body ?? "",
              fields: exemplar?.fields ?? {},
              tags: [],
              assets: [],
            },
            presentation: {
              template: { id: template.id, version: template.version },
              theme: {},
            },
          });
          return (
            <div key={template.id} className="workspace-template-card">
              <span className="workspace-template-thumb" aria-hidden="true">
                <span className="workspace-template-thumb-inner">
                  <DocumentRenderer
                    document={document}
                    template={template}
                    documentId={`strip-${slug}`}
                  />
                </span>
              </span>
              <a
                className="workspace-template-name"
                href={`/start?template=${slug}`}
                title={template.description}
              >
                {template.name}
              </a>
            </div>
          );
        })}
      </div>
    </section>
  );
}
