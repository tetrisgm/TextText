// The template gallery: every built-in look shown as a live miniature.

import Link from "next/link";
import type { Metadata } from "next";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { templateExamples } from "./shared";

export const metadata: Metadata = {
  title: "Choose a look · Texttext",
  description: "Choose a familiar look for a Texttext document.",
};

const GALLERY_CSS = `
.tpl-gallery{max-width:92rem;margin:0 auto;padding:3.5rem 2rem 6rem;color:var(--ink,#1d1d1f)}
.tpl-gallery>h1{font-size:clamp(2rem,4vw,2.75rem);line-height:1.05;font-weight:700;margin:0 0 2rem;text-align:center}
.tpl-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}
.tpl-card{position:relative;aspect-ratio:16/10;border:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 13%,transparent);border-radius:8px;overflow:hidden;background:var(--paper,#fff);transition:border-color 140ms ease,transform 140ms ease}
.tpl-card:hover{border-color:color-mix(in srgb,var(--ink,#1d1d1f) 30%,transparent);transform:translateY(-2px)}
.tpl-card:focus-within{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#007aff) 28%,transparent)}
.tpl-card-link{display:block;text-decoration:none;color:inherit}
.tpl-card-link::after{content:"";position:absolute;inset:0}
.tpl-card-link:focus-visible{outline:0}
.tpl-thumb{position:relative;height:100%;overflow:hidden;pointer-events:none;container-type:inline-size}
.tpl-thumb-inner{width:calc(100cqw/0.3);transform:scale(.3);transform-origin:top left}
.tpl-card-name{position:absolute;right:.65rem;bottom:.65rem;padding:.38rem .55rem;border:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 10%,transparent);border-radius:6px;background:color-mix(in srgb,var(--paper,#fff) 90%,transparent);color:var(--ink,#1d1d1f);font-size:.75rem;font-weight:600;backdrop-filter:blur(16px) saturate(1.4)}
@media(max-width:900px){.tpl-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:620px){.tpl-gallery{padding-inline:1rem}.tpl-grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.tpl-card{transition:none}.tpl-card:hover{transform:none}}
@media(prefers-color-scheme:dark){.tpl-gallery{--paper:#1c1c1e;--ink:#f5f5f7;--muted:#a1a1a6}}
`;

export default function TemplatesPage() {
  const examples = templateExamples();
  return (
    <main className="tpl-gallery">
      <style>{GALLERY_CSS}</style>
      <h1>Choose a look</h1>
      <div className="tpl-grid">
        {examples.map((entry) => (
          <div key={entry.slug} className="tpl-card">
            <div className="tpl-thumb" aria-hidden="true">
              <div className="tpl-thumb-inner">
                <DocumentRenderer
                  document={entry.document}
                  template={entry.template}
                  documentId={`tpl-thumb-${entry.slug}`}
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
