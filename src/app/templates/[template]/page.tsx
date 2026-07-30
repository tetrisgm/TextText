// One template, full size: the complete example item rendered by the same
// engine that renders published pages, with the template's name, group, and
// a path into using it.

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { templateExample, templateExamples } from "../shared";

export function generateStaticParams() {
  return templateExamples().map((entry) => ({ template: entry.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ template: string }>;
}): Promise<Metadata> {
  const { template } = await params;
  const example = templateExample(template);
  if (!example) return { title: "Templates · Texttext" };
  return {
    title: `${example.template.name} template · Texttext`,
    description: example.template.description,
  };
}

const DETAIL_CSS = `
.tpl-detail-bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:1rem;padding:.7rem 1.25rem;background:color-mix(in srgb,var(--paper,#fff) 88%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 10%,transparent);color:var(--ink,#1d1d1f)}
.tpl-detail-bar a{color:inherit;text-decoration:none;font-size:.88rem;font-weight:600}
.tpl-detail-bar .tpl-detail-name{margin-right:auto;display:flex;align-items:baseline;gap:.6rem}
.tpl-detail-bar .tpl-detail-name strong{font-size:.95rem}
.tpl-detail-bar .tpl-detail-name span{font-size:.78rem;color:var(--muted,#6e6e73)}
.tpl-detail-use{padding:.4rem 1rem;border-radius:999px;background:var(--ink,#1d1d1f);color:var(--paper,#fff)!important;font-size:.85rem}
.tpl-detail-note{max-width:46rem;margin:0 auto;padding:1.5rem 1rem 0;font-size:.85rem;color:var(--muted,#6e6e73);text-align:center}
@media(prefers-color-scheme:dark){.tpl-detail-bar{--paper:#1c1c1e;--ink:#f5f5f7;--muted:#a1a1a6}.tpl-detail-note{color:#a1a1a6}}
`;

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ template: string }>;
}) {
  const { template } = await params;
  const example = templateExample(template);
  if (!example) notFound();
  return (
    <main>
      <style>{DETAIL_CSS}</style>
      <div className="tpl-detail-bar">
        <Link href="/templates">&larr; All templates</Link>
        <span className="tpl-detail-name">
          <strong>{example.template.name}</strong>
          <span>{example.category}</span>
        </span>
        <Link
          href={`/start?template=${example.slug}&seed=1`}
          className="tpl-detail-use"
        >
          Use this template
        </Link>
      </div>
      <p className="tpl-detail-note">
        {example.template.description} Below is a complete example item rendered
        by the engine, exactly as it publishes.
      </p>
      <DocumentRenderer
        document={example.document}
        template={example.template}
        documentId={`tpl-example-${example.slug}`}
        metadata={{ author: "Example", date: "Jul 29, 2026" }}
      />
    </main>
  );
}
