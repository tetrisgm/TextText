// The template gallery: every built-in look shown as a live miniature.

import Link from "next/link";
import type { Metadata } from "next";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { templateExamples } from "./shared";

export const metadata: Metadata = {
  title: "Choose a look · TextText",
  description: "Choose a familiar look for a TextText document.",
};

const GALLERY_CSS = `
.tpl-gallery{max-width:92rem;margin:0 auto;padding:3.5rem 2rem 6rem;color:var(--ink,#1d1d1f)}
.tpl-back{display:inline-flex;align-items:center;gap:.4rem;min-height:2rem;margin:0 0 2rem;color:var(--ink,#1d1d1f);font-size:.875rem;font-weight:600;text-decoration:none}
.tpl-back:hover{text-decoration:underline;text-underline-offset:.18rem}
.tpl-back:focus-visible{outline:3px solid color-mix(in srgb,var(--accent,#007aff) 28%,transparent);outline-offset:4px;border-radius:4px}
.tpl-gallery-header{margin:0 0 1.5rem;padding-bottom:1rem;border-bottom:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 12%,transparent)}
.tpl-gallery-header h1{font-size:clamp(2rem,4vw,2.75rem);line-height:1.05;font-weight:700;margin:0;text-wrap:balance}
.tpl-gallery-header p{margin:.45rem 0 0;color:var(--muted,#6e6e73);font-size:.875rem}
.tpl-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1rem}
.tpl-card{position:relative;display:flex;flex-direction:column;border:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 13%,transparent);border-radius:10px;overflow:hidden;background:var(--paper,#fff);transition:border-color 140ms ease}
.tpl-card:hover{border-color:color-mix(in srgb,var(--ink,#1d1d1f) 38%,transparent)}
.tpl-card:focus-within{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#007aff) 28%,transparent)}
.tpl-card-link{display:block;text-decoration:none;color:inherit}
.tpl-card-link::after{content:"";position:absolute;inset:0}
.tpl-card-link:focus-visible{outline:0}
/* The miniature is the whole card above the name, and the document paints its
   own paper right to the edges so no card background shows through. */
.tpl-thumb{position:relative;aspect-ratio:4/3;overflow:hidden;pointer-events:none;container-type:inline-size}
.tpl-thumb-inner{width:calc(100cqw/0.3);transform:scale(.3);transform-origin:top left}
.tpl-thumb-inner .tt-document{min-height:1400px}
/* The name sits under the preview, never on top of the words it labels. */
.tpl-card-name{display:block;padding:.6rem .75rem;border-top:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 12%,transparent);background:var(--paper,#fff);color:var(--ink,#1d1d1f);font-size:.8125rem;font-weight:650}
@media(max-width:1180px){.tpl-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:620px){.tpl-gallery{padding:2rem 1rem 4rem}.tpl-back{margin-bottom:1.5rem}.tpl-grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.tpl-card{transition:none}}
@media(prefers-color-scheme:dark){.tpl-gallery{--paper:#1c1c1e;--ink:#f5f5f7;--muted:#a1a1a6}}
`;

export default function TemplatesPage() {
  const examples = templateExamples();
  return (
    <main className="tpl-gallery">
      <style>{GALLERY_CSS}</style>
      <Link href="/" className="tpl-back" aria-label="Back to TextText">
        <span aria-hidden="true">&larr;</span>
        Back
      </Link>
      <header className="tpl-gallery-header">
        <h1>Choose a look</h1>
        <p>Start here. Change anything later.</p>
      </header>
      <div className="tpl-grid">
        {examples.map((entry) => (
          <div key={entry.slug} className="tpl-card">
            <div className="tpl-thumb" aria-hidden="true">
              <div className="tpl-thumb-inner">
                <DocumentRenderer
                  document={entry.document}
                  template={entry.template}
                  documentId={`tpl-thumb-${entry.slug}`}
                  preview
                />
              </div>
            </div>
            <Link
              href={`/templates/${entry.slug}`}
              className="tpl-card-link"
              aria-label={`Preview ${entry.template.name}`}
              title={entry.template.description}
            >
              <span className="tpl-card-name">{entry.template.name}</span>
            </Link>
          </div>
        ))}
      </div>
    </main>
  );
}
