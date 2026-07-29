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
import { DocumentRenderer } from "../src/components/document/DocumentRenderer";
import { BUILTIN_TEMPLATES } from "../src/lib/presentation/templates";
import type {
  DocumentFieldDefinition,
  RowSubFieldDefinition,
  TemplateDefinition,
} from "../src/lib/presentation/schema";
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
      assets: [],
    },
    presentation: {
      template: { id: template.id, version: template.version },
      theme: {},
    },
  });
}

/** Node types composed in the template's item spec, so we can assert each one
 * left a trace in the HTML. */
function composedTypes(node: unknown, into = new Set<string>()): Set<string> {
  if (typeof node !== "object" || node === null) return into;
  const record = node as { type?: string; children?: unknown[] };
  if (record.type) into.add(record.type);
  for (const child of record.children ?? []) composedTypes(child, into);
  return into;
}

/** The CSS class each wave-1 node emits; presence proves the renderer handled
 * it rather than silently skipping an unknown type. */
const NODE_MARKERS: Record<string, string> = {
  badge: "tt-badge",
  facts: "tt-facts",
  checklist: "tt-checklist",
  rows: "tt-rows",
  progress: "tt-progress",
  callout: "tt-callout",
  quote: "tt-quote",
};

let failures = 0;
for (const template of BUILTIN_TEMPLATES) {
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
  const missing = [...composedTypes(template.item)]
    .filter((type) => NODE_MARKERS[type] && !html.includes(NODE_MARKERS[type]));
  if (missing.length > 0) {
    console.error(
      `FAIL ${template.id}: composed node(s) left no markup: ${missing.join(", ")}`,
    );
    failures += 1;
    continue;
  }
  console.log(`ok   ${template.id} (${html.length} chars)`);
}

if (failures > 0) {
  console.error(`${failures} template(s) failed to render.`);
  process.exit(1);
}
console.log(
  JSON.stringify({ status: "pass", templates: BUILTIN_TEMPLATES.length }),
);
