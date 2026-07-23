import assert from "node:assert/strict";
import * as Y from "yjs";
import { compileDocumentHtml } from "@/lib/presentation/export.server";
import {
  createDocumentYDoc,
  documentSnapshotFromYDoc,
  documentText,
  encodeDocumentBaseline,
} from "@/lib/collab/document";
import {
  emptyDocumentSnapshot,
  validateDocumentSnapshot,
} from "@/lib/documents/model";
import {
  parseSyncDocumentEnvelope,
  serializeSyncDocumentEnvelope,
  SYNC_DOCUMENT_SCHEMA,
} from "@/lib/documents/sync";
import { resolveDocumentVisibility } from "@/lib/documents/visibility";
import { applyTemplateOperations } from "@/lib/presentation/operations";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import {
  BUILTIN_TEMPLATES,
  requireBuiltinTemplate,
} from "@/lib/presentation/templates";

function verifyBuiltinsAndConstrainedAuthoring(): void {
  assert.ok(BUILTIN_TEMPLATES.length >= 5);
  for (const template of BUILTIN_TEMPLATES) {
    assert.deepEqual(validateTemplateDefinition(template), template);
  }

  const article = requireBuiltinTemplate("texttext.article");
  const customized = applyTemplateOperations(article, [
    { op: "set-name", name: "Compact dispatch" },
    {
      op: "set-theme",
      theme: {
        accent: "#1473E6",
        alignment: "start",
        density: "compact",
      },
    },
    { op: "set-collection-layout", layout: "list", columns: 1 },
  ]);
  assert.equal(customized.name, "Compact dispatch");
  assert.equal(customized.collection.layout, "list");
  assert.equal(customized.collection.columns, 1);
  assert.equal(customized.theme.accent, "#1473E6");
  assert.throws(() =>
    validateTemplateDefinition({
      ...customized,
      item: {
        type: "text",
        bind: "content.fields.notDeclared",
        role: "body",
      },
    }),
  );
}

function fixtureDocument() {
  return validateDocumentSnapshot({
    ...emptyDocumentSnapshot(),
    content: {
      title: "Fast, portable documents",
      subtitle: "One content model, many presentations.",
      body: "Hello **world**.\n\n<script>alert('blocked')</script>",
      fields: {
        cover: "https://images.example.test/cover.png",
      },
      tags: ["architecture"],
      assets: [],
    },
  });
}

function verifyRenderingAndSyncProjection(): void {
  const document = fixtureDocument();
  const article = requireBuiltinTemplate("texttext.article");
  const html = compileDocumentHtml({ document, template: article });
  assert.match(html, /Fast, portable documents/);
  assert.match(html, /<strong>world<\/strong>/);
  assert.doesNotMatch(html, /<script>alert/);

  const envelope = {
    schema: SYNC_DOCUMENT_SCHEMA,
    markdown: `---\ntitle: "${document.content.title}"\n---\n\n${document.content.body}\n`,
    document,
  } as const;
  const first = serializeSyncDocumentEnvelope(envelope);
  const second = serializeSyncDocumentEnvelope(parseSyncDocumentEnvelope(first));
  assert.equal(first, second);
  assert.deepEqual(parseSyncDocumentEnvelope(first).document, document);
}

function verifyFailClosedVisibility(): void {
  assert.equal(
    resolveDocumentVisibility({
      requested: "public",
      compatibilityType: "note",
    }),
    "private",
  );
  assert.equal(
    resolveDocumentVisibility({
      requested: "public",
      compatibilityType: "bookmark",
    }),
    "private",
  );
  assert.equal(
    resolveDocumentVisibility({ compatibilityType: "article" }),
    "private",
  );
  assert.equal(
    resolveDocumentVisibility({
      requested: "link",
      compatibilityType: "article",
    }),
    "link",
  );
}

function verifyCollaborationProjection(): void {
  const snapshot = fixtureDocument();
  const baseline = encodeDocumentBaseline(snapshot, "document-engine-eval");
  const left = createDocumentYDoc();
  const right = createDocumentYDoc();
  const merged = createDocumentYDoc();
  for (const doc of [left, right, merged]) Y.applyUpdate(doc, baseline);

  documentText(left, "title").insert(snapshot.content.title.length, " together");
  documentText(right, "body").insert(snapshot.content.body.length, "\n\nFrom another editor.");
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(left));
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(right));

  const result = documentSnapshotFromYDoc(merged);
  assert.equal(result.content.title, `${snapshot.content.title} together`);
  assert.match(result.content.body, /From another editor\./);
  assert.deepEqual(result.presentation, snapshot.presentation);
  left.destroy();
  right.destroy();
  merged.destroy();
}

verifyBuiltinsAndConstrainedAuthoring();
verifyRenderingAndSyncProjection();
verifyFailClosedVisibility();
verifyCollaborationProjection();

console.log(JSON.stringify({
  status: "pass",
  builtInTemplates: BUILTIN_TEMPLATES.length,
  checks: 4,
}));
