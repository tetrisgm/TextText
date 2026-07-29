// The template gallery: every built-in look, grouped the way the create menu
// groups them, each card a live miniature of a real example item. This is the
// one place to SEE the whole catalog; each card opens the full example.

import Link from "next/link";
import type { Metadata } from "next";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { TEMPLATE_CATEGORIES } from "@/lib/presentation/templates";
import { templateExamples } from "./shared";

export const metadata: Metadata = {
  title: "Templates · Texttext",
  description:
    "Every built-in look, shown as a real example item: lists, logs, invites, specs, polls, and more.",
};

const GALLERY_CSS = `
.tpl-gallery{max-width:72rem;margin:0 auto;padding:3rem 1.5rem 6rem;color:var(--ink,#1d1d1f)}
.tpl-gallery>h1{font-size:clamp(2rem,5vw,3.25rem);line-height:1.05;font-weight:750;margin:0}
.tpl-gallery .tpl-intro{margin:.75rem 0 0;font-size:1.05rem;line-height:1.6;color:var(--muted,#6e6e73);max-width:38rem}
.tpl-gallery section>h2{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted,#6e6e73);margin:3rem 0 1rem}
.tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));gap:1.25rem}
.tpl-card{position:relative;border:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 12%,transparent);border-radius:.9rem;overflow:hidden;background:var(--paper,#fff);transition:border-color .15s ease,transform .15s ease}
.tpl-card:hover{border-color:color-mix(in srgb,var(--ink,#1d1d1f) 30%,transparent);transform:translateY(-2px)}
.tpl-card-link{display:block;text-decoration:none;color:inherit}
.tpl-card-link::after{content:"";position:absolute;inset:0}
.tpl-thumb{position:relative;height:13rem;overflow:hidden;border-bottom:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 8%,transparent);pointer-events:none;container-type:inline-size}
.tpl-thumb-inner{width:calc(100cqw/0.3);transform:scale(.3);transform-origin:top left}
.tpl-thumb::after{content:"";position:absolute;inset:auto 0 0 0;height:3.5rem;background:linear-gradient(transparent,var(--paper,#fff))}
.tpl-card-copy{padding:.85rem 1rem 1rem}
.tpl-card-copy strong{display:block;font-size:.98rem;font-weight:700}
.tpl-card-copy span{display:block;margin-top:.2rem;font-size:.82rem;line-height:1.45;color:var(--muted,#6e6e73)}
@media(prefers-color-scheme:dark){.tpl-gallery{--paper:#1c1c1e;--ink:#f5f5f7;--muted:#a1a1a6}}
`;

export default function TemplatesPage() {
  const examples = templateExamples();
  return (
    <main className="tpl-gallery">
      <style>{GALLERY_CSS}</style>
      <h1>Templates</h1>
      <p className="tpl-intro">
        Every document in Texttext has a look: typed fields, a layout, and folder
        behavior. These are the built-in looks, each shown as a real example.
        Open one to read it full size.
      </p>
      {TEMPLATE_CATEGORIES.map((category) => {
        const group = examples.filter((entry) => entry.category === category);
        if (group.length === 0) return null;
        return (
          <section key={category}>
            <h2>{category}</h2>
            <div className="tpl-grid">
              {group.map((entry) => (
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
                  <Link href={`/templates/${entry.slug}`} className="tpl-card-link">
                    <div className="tpl-card-copy">
                      <strong>{entry.template.name}</strong>
                      <span>{entry.template.description}</span>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
