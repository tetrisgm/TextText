// Every built-in template must RENDER, not merely validate.
//
// validateTemplateDefinition proves schema conformance; it says nothing about
// whether the renderer can walk the composition. The thoroughness audit found
// exactly that gap: 23 templates validated and only one had ever been seen on
// a screen. This gate renders each one to real HTML with a representative
// document generated from the template's own declared fields, and fails on a
// throw, on empty output, and on a composed node type that produced no markup.
//
//   npx tsx scripts/verify-template-render.ts

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentCollectionRenderer, DocumentRenderer } from "../src/components/document/DocumentRenderer";
import { ALL_RESOLVABLE_TEMPLATES } from "../src/lib/presentation/templates";
import type {
  DocumentFieldDefinition,
  RowSubFieldDefinition,
  TemplateDefinition,
} from "../src/lib/presentation/schema";
import { validateTemplateDefinition } from "../src/lib/presentation/schema";
import {
  validateDocumentSnapshot,
  type DocumentFieldValue,
} from "../src/lib/documents/model";

/** A plausible value for any declared field, so skip-empty nodes render. */
function sampleValue(
  field: DocumentFieldDefinition | RowSubFieldDefinition,
): DocumentFieldValue {
  switch (field.type) {
    case "text":
      return `Sample ${field.label.toLowerCase()}`;
    case "richtext":
      return `A paragraph of ${field.label.toLowerCase()} with enough words to wrap.`;
    case "image":
      return "https://example.com/sample.jpg";
    case "date":
      return "2026-07-15";
    case "url":
      return "https://example.com";
    case "enum":
      return field.multiple && "multiple" in field
        ? [field.options[0].value]
        : field.options[0].value;
    case "number":
      return field.max != null ? Math.min(field.max, 3) : 3;
    case "boolean":
      return true;
    case "reference":
      return field.multiple ? ["00000000-0000-4000-8000-000000000000"] : "00000000-0000-4000-8000-000000000000";
    case "rows": {
      const row = () =>
        Object.fromEntries(
          field.fields.map((sub) => [sub.id, sampleValue(sub) as never]),
        );
      return [row(), row(), row()];
    }
  }
}

function sampleDocument(template: TemplateDefinition) {
  return validateDocumentSnapshot({
    schemaVersion: 1,
    content: {
      title: `${template.name} sample`,
      subtitle: "A representative subtitle",
      body: "A body paragraph with **bold**, a [link](https://example.com), and enough text to look real.\n\nA second paragraph.",
      fields: Object.fromEntries(
        template.fields.map((field) => [field.id, sampleValue(field)]),
      ),
      tags: ["sample", "verify"],
      // One asset, so a gallery renders instead of returning null. With an
      // empty list the gallery node composed nothing, and the marker check
      // could not tell that apart from a renderer that had stopped handling
      // it. Two looks were exercising a node that produced no markup at all.
      assets: [
        {
          id: "sample-asset",
          kind: "image" as const,
          src: "https://example.com/sample.jpg",
          alt: "A sample image",
        },
      ],
    },
    presentation: {
      template: { id: template.id, version: template.version },
      theme: {},
    },
  });
}

/** Node types composed in the template's item spec, so we can assert each one
 * left a trace in the HTML. */
/**
 * The CSS classes a spec's nodes must produce.
 *
 * Derived per NODE, not per type. An earlier version collected type names and
 * looked each up in a fixed map, so `media` was assumed to mean `tt-image`: a
 * renderer emitting `tt-image` for a cover would have passed, and a correct
 * one emitting `tt-cover` would have failed. The class depends on the node's
 * own properties, so the expectation has to be read from the node.
 */
const NODE_MARKERS: Record<string, string> = {
  badge: "tt-badge",
  facts: "tt-facts",
  checklist: "tt-checklist",
  rows: "tt-rows",
  progress: "tt-progress",
  poll: "tt-poll",
  callout: "tt-callout",
  quote: "tt-quote",
  gallery: "tt-gallery",
  byline: "tt-byline",
  metadata: "tt-metadata",
  divider: "tt-divider",
  spacer: "tt-spacer",
  cover: "tt-cover",
  image: "tt-image",
  video: "tt-video",
};

function expectedMarkers(node: unknown, into = new Set<string>()): Set<string> {
  if (typeof node !== "object" || node === null) return into;
  const n = node as {
    type?: string;
    kind?: string;
    variant?: string;
    rule?: boolean;
    children?: unknown[];
  };
  if (n.type === "media") into.add(`tt-${n.kind ?? "image"}`);
  else if (n.type === "meta")
    into.add(n.variant === "metadata" ? "tt-metadata" : "tt-byline");
  else if (n.type === "space") into.add(n.rule ? "tt-divider" : "tt-spacer");
  else if (n.type && NODE_MARKERS[n.type]) into.add(NODE_MARKERS[n.type]);
  for (const child of n.children ?? []) expectedMarkers(child, into);
  return into;
}

let failures = 0;
// Retired looks are still resolvable, so a document pinned to one still has
// to render. Walking only the active set is how a break in Wiki or Newsletter
// would ship unnoticed.
for (const template of ALL_RESOLVABLE_TEMPLATES) {
  const document = sampleDocument(template);
  let html = "";
  try {
    html = renderToStaticMarkup(
      React.createElement(DocumentRenderer, {
        document,
        documentId: `verify-${template.id}`,
        template,
        metadata: { author: "Verifier", date: "Jul 15, 2026" },
      }),
    );
  } catch (error) {
    console.error(`FAIL ${template.id}: renderer threw: ${error}`);
    failures += 1;
    continue;
  }
  if (html.length < 200) {
    console.error(`FAIL ${template.id}: implausibly small output (${html.length} chars)`);
    failures += 1;
    continue;
  }
  // Look for the class in MARKUP, not anywhere in the string. Every render
  // embeds the whole engine stylesheet, which contains `.tt-badge{...}` and a
  // rule for every other marker, so `html.includes("tt-badge")` was true for
  // every template whatever the renderer did. Every marker in this gate was
  // vacuous, and had been since it was written.
  const inMarkup = (html: string, marker: string) =>
    new RegExp(`class="[^"]*\\b${marker}\\b`).test(html);

  // collection.item is rendered by a different component and was never walked
  // here, so a node that only appears in a folder view went unchecked.
  let collectionHtml = "";
  try {
    collectionHtml = renderToStaticMarkup(
      React.createElement(DocumentCollectionRenderer, {
        document,
        documentId: `verify-collection-${template.id}`,
        template,
        metadata: { author: "Verifier", date: "Jul 15, 2026" },
      }),
    );
  } catch (error) {
    console.error(`FAIL ${template.id}: collection renderer threw: ${error}`);
    failures += 1;
    continue;
  }
  const missing = [
    ...[...expectedMarkers(template.item)].filter((m) => !inMarkup(html, m)),
    ...[...expectedMarkers(template.collection.item)].filter(
      (m) => !inMarkup(collectionHtml, m),
    ),
  ];
  if (missing.length > 0) {
    console.error(
      `FAIL ${template.id}: composed node(s) left no markup: ${missing.join(", ")}`,
    );
    failures += 1;
    continue;
  }
  console.log(`ok   ${template.id} (${html.length} chars)`);
}

// The built-ins only emit legacy spellings, so nothing above renders a media,
// meta or space node. Render one of each directly, or the target half of the
// grammar ships with no render coverage at all.
for (const [label, node, marker] of [
  ["media cover", { type: "media", kind: "cover", bind: "content.fields.hero" }, "tt-cover"],
  ["media image", { type: "media", kind: "image", bind: "content.fields.hero" }, "tt-image"],
  ["media video", { type: "media", kind: "video", bind: "content.fields.hero" }, "tt-video"],
  ["meta byline", { type: "meta", variant: "byline" }, "tt-byline"],
  ["meta metadata", { type: "meta", variant: "metadata" }, "tt-metadata"],
  ["space rule", { type: "space", rule: true }, "tt-divider"],
  ["space gap", { type: "space", rule: false }, "tt-spacer"],
] as const) {
  const template = validateTemplateDefinition({
    schemaVersion: 1,
    engineVersion: 1,
    id: "verify.target-grammar",
    version: 1,
    name: "Target grammar",
    fields: [{ id: "hero", label: "Hero", type: "image" }],
    item: { type: "stack", children: [node] },
    collection: {
      layout: "list",
      item: { type: "stack", children: [{ type: "text", bind: "content.title", role: "title" }] },
    },
    theme: {},
  });
  const document = sampleDocument(template);
  let html = "";
  try {
    html = renderToStaticMarkup(
      React.createElement(DocumentRenderer, {
        document,
        documentId: `verify-${label.replace(/\s/g, "-")}`,
        template,
        metadata: { author: "Verifier", date: "Jul 15, 2026" },
      }),
    );
  } catch (error) {
    console.error(`FAIL ${label}: renderer threw: ${error}`);
    failures += 1;
    continue;
  }
  if (!new RegExp(`class="[^"]*\\b${marker}\\b`).test(html)) {
    console.error(`FAIL ${label}: expected ${marker} in the markup`);
    failures += 1;
    continue;
  }
  console.log(`ok   ${label} (${marker})`);
}

if (failures > 0) {
  console.error(`${failures} template(s) failed to render.`);
  process.exit(1);
}
console.log(
  JSON.stringify({ status: "pass", templates: ALL_RESOLVABLE_TEMPLATES.length }),
);
