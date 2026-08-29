import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentCollectionRenderer, DocumentRenderer } from "../src/components/document/DocumentRenderer";
import { ALL_RESOLVABLE_TEMPLATES } from "../src/lib/presentation/templates";
import { DOCUMENT_ENGINE_CSS } from "../src/lib/presentation/styles";
import { validateDocumentSnapshot } from "../src/lib/documents/model";

// Deterministic visual contract: every resolvable look must expose the same
// theme axes in both page and collection renders. This catches regressions
// where a new template renders but silently loses the shared look system.
const themes = [
  { surface: "system", typography: "system" },
  { surface: "ink", typography: "editorial" },
] as const;
const required = ["data-typography", "data-density", "data-measure", "data-surface", "data-title-scale", "data-body-scale", "data-alignment", "data-media"];
const doc = validateDocumentSnapshot({
  schemaVersion: 1,
  content: { title: "Contract sample", body: "A representative paragraph.", fields: {}, tags: [], assets: [] },
  presentation: { template: { id: ALL_RESOLVABLE_TEMPLATES[0].id, version: 1 }, theme: {} },
});
let failures = 0;
if (!DOCUMENT_ENGINE_CSS.includes('[data-surface="ink"]') || !DOCUMENT_ENGINE_CSS.includes('[data-typography="editorial"]')) {
  console.error("FAIL look CSS is missing dark or editorial contracts"); failures++;
}
for (const template of ALL_RESOLVABLE_TEMPLATES) {
  for (const theme of themes) {
    const themed = { ...doc, presentation: { ...doc.presentation, template: { id: template.id, version: template.version }, theme } };
    for (const [label, element] of [
      ["item", React.createElement(DocumentRenderer, { document: themed, template, documentId: `contract-${template.id}`, metadata: {} })],
      ["collection", React.createElement(DocumentCollectionRenderer, { document: themed, template, documentId: `contract-${template.id}`, metadata: {} })],
    ] as const) {
      const html = renderToStaticMarkup(element);
      for (const attr of required) if (!html.includes(`${attr}=`)) { console.error(`FAIL ${template.id} ${label} ${theme.surface}: missing ${attr}`); failures++; }
      if (!html.includes(`data-surface="${theme.surface}"`)) { console.error(`FAIL ${template.id} ${label}: theme not propagated`); failures++; }
    }
  }
}
if (failures) process.exit(1);
console.log(JSON.stringify({ status: "pass", templates: ALL_RESOLVABLE_TEMPLATES.length, themes: themes.length }));
