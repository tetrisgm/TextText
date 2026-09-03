import * as Y from "yjs";
import {
  validateDocumentSnapshot,
  type DocumentAsset,
  type DocumentFieldValue,
  type DocumentSnapshot,
} from "@/lib/documents/model";

const ROOT_KEY = "document";
const APPLIED_OPERATIONS_KEY = "agentOperations";
const MAX_APPLIED_OPERATIONS = 256;

export type DocumentMutation = {
  title?: string;
  subtitle?: string | null;
  body?: string;
  appendBody?: string;
  /**
   * Replace one Markdown section body against the live Y.Text. The expected
   * body is checked inside the same transaction before any characters are
   * changed, so an edit elsewhere can merge while an edit to this section
   * fails closed.
   */
  bodySection?: {
    heading: string;
    expectedBody: string;
    replacementBody: string;
  };
  /**
   * Replace one exact text range against the live Y.Text. This is the
   * collaboration-safe form of accepting an assistant selection preview: an
   * unrelated edit can merge, while a changed selection fails closed.
   */
  textRange?: {
    field: "title" | "subtitle" | "body";
    start: number;
    end: number;
    expectedText: string;
    replacementText: string;
  };
  tags?: string[];
  /** Declared field values. A null clears one. */
  fields?: Record<string, DocumentFieldValue | null>;
  /** The look, as an exact pinned reference. */
  template?: { id: string; version: number };
  assets?: DocumentAsset[];
  operationId?: string;
};

export class DocumentSectionConflictError extends Error {
  constructor() {
    super("The section changed while this command was running.");
    this.name = "DocumentSectionConflictError";
  }
}

export class DocumentTextRangeConflictError extends Error {
  constructor() {
    super("The selected text changed while this command was running.");
    this.name = "DocumentTextRangeConflictError";
  }
}

type MarkdownSection = {
  heading: string;
  title: string;
  level: number;
  bodyLines: { start: number; end: number };
};

function markdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split("\n");
  const headings: Array<{
    line: number;
    level: number;
    title: string;
    heading: string;
  }> = [];
  let fence: "```" | "~~~" | null = null;
  for (const [line, raw] of lines.entries()) {
    const trimmed = raw.trimStart();
    const marker = trimmed.startsWith("```")
      ? "```"
      : trimmed.startsWith("~~~")
        ? "~~~"
        : null;
    if (marker) {
      fence = fence === marker ? null : (fence ?? marker);
      continue;
    }
    if (fence) continue;
    const match = /^(#{1,6})(?:\s(.*)|$)/.exec(trimmed);
    if (!match) continue;
    headings.push({
      line,
      level: match[1].length,
      title: (match[2] ?? "").trim(),
      heading: raw,
    });
  }
  return headings.map((heading, index) => {
    const next = headings
      .slice(index + 1)
      .find((candidate) => candidate.level <= heading.level);
    return {
      heading: heading.heading,
      title: heading.title,
      level: heading.level,
      bodyLines: { start: heading.line + 1, end: next?.line ?? lines.length },
    };
  });
}

function findMarkdownSection(
  markdown: string,
  requested: string,
): MarkdownSection | null {
  const sections = markdownSections(markdown);
  const wanted = requested.trim();
  const exact = sections.find((section) => section.heading.trim() === wanted);
  if (exact) return exact;
  const title = wanted.replace(/^#+/, "").trim().toLowerCase();
  return (
    sections.find((section) => section.title.toLowerCase() === title) ?? null
  );
}

function sectionBody(markdown: string, section: MarkdownSection): string {
  return markdown
    .split("\n")
    .slice(section.bodyLines.start, section.bodyLines.end)
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

function replacingSectionBody(
  markdown: string,
  section: MarkdownSection,
  replacement: string,
): string {
  const lines = markdown.split("\n");
  const body = replacement.replace(/^\n+|\n+$/g, "").split("\n");
  const inserted = ["", ...body];
  if (section.bodyLines.end < lines.length) inserted.push("");
  lines.splice(
    section.bodyLines.start,
    section.bodyLines.end - section.bodyLines.start,
    ...inserted,
  );
  return lines.join("\n");
}

export function replaceMarkdownSectionBodyIfUnchanged(
  markdown: string,
  heading: string,
  expectedBody: string,
  replacementBody: string,
): string | null {
  const section = findMarkdownSection(markdown, heading);
  if (!section || sectionBody(markdown, section) !== expectedBody) return null;
  return replacingSectionBody(markdown, section, replacementBody);
}

function replaceLiveBodySection(
  target: Y.Text,
  mutation: NonNullable<DocumentMutation["bodySection"]>,
): void {
  const current = target.toString();
  const updated = replaceMarkdownSectionBodyIfUnchanged(
    current,
    mutation.heading,
    mutation.expectedBody,
    mutation.replacementBody,
  );
  if (updated === null) {
    throw new DocumentSectionConflictError();
  }
  if (updated === current) return;

  let prefix = 0;
  const commonLength = Math.min(current.length, updated.length);
  while (prefix < commonLength && current[prefix] === updated[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < updated.length - prefix &&
    current[current.length - 1 - suffix] ===
      updated[updated.length - 1 - suffix]
  ) {
    suffix++;
  }
  const deleteCount = current.length - prefix - suffix;
  const insertion = updated.slice(prefix, updated.length - suffix);
  if (deleteCount) target.delete(prefix, deleteCount);
  if (insertion) target.insert(prefix, insertion);
}

function replaceLiveTextRange(
  target: Y.Text,
  mutation: NonNullable<DocumentMutation["textRange"]>,
): void {
  const current = target.toString();
  if (
    !Number.isInteger(mutation.start) ||
    !Number.isInteger(mutation.end) ||
    mutation.start < 0 ||
    mutation.end < mutation.start ||
    mutation.end > current.length ||
    current.slice(mutation.start, mutation.end) !== mutation.expectedText
  ) {
    throw new DocumentTextRangeConflictError();
  }
  const deleteCount = mutation.end - mutation.start;
  if (deleteCount) target.delete(mutation.start, deleteCount);
  if (mutation.replacementText) {
    target.insert(mutation.start, mutation.replacementText);
  }
}

function root(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(ROOT_KEY);
}

/**
 * The document's root map. `doc.getMap` always returns the same instance and
 * the map itself is never replaced, so this is the one stable handle on the
 * document - unlike the Y.Texts inside it, which `text()` creates on demand
 * and a remote baseline can supersede. Anything that must watch the whole
 * document for its lifetime (undo, for one) has to hold THIS.
 */
export function documentRoot(doc: Y.Doc): Y.Map<unknown> {
  return root(doc);
}

function text(rootMap: Y.Map<unknown>, key: string): Y.Text {
  const existing = rootMap.get(key);
  if (existing instanceof Y.Text) return existing;
  const value = new Y.Text();
  rootMap.set(key, value);
  return value;
}

function map(rootMap: Y.Map<unknown>, key: string): Y.Map<unknown> {
  const existing = rootMap.get(key);
  if (existing instanceof Y.Map) return existing;
  const value = new Y.Map<unknown>();
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    for (const [entryKey, entryValue] of Object.entries(existing)) {
      value.set(entryKey, entryValue);
    }
  }
  rootMap.set(key, value);
  return value;
}

function array(rootMap: Y.Map<unknown>, key: string): Y.Array<unknown> {
  const existing = rootMap.get(key);
  if (existing instanceof Y.Array) return existing;
  const value = new Y.Array<unknown>();
  rootMap.set(key, value);
  return value;
}

function replaceText(target: Y.Text, value: string): void {
  if (target.toString() === value) return;
  target.delete(0, target.length);
  if (value) target.insert(0, value);
}

function replaceMap(
  target: Y.Map<unknown>,
  value: Record<string, unknown>,
  preservedKeys: ReadonlySet<string> = new Set(),
): void {
  for (const key of Array.from(target.keys())) {
    if (!preservedKeys.has(key) && !(key in value)) target.delete(key);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (JSON.stringify(target.get(key)) !== JSON.stringify(entry)) {
      target.set(key, entry);
    }
  }
}

function replaceArray(target: Y.Array<unknown>, value: unknown[]): void {
  if (JSON.stringify(target.toArray()) === JSON.stringify(value)) return;
  if (target.length) target.delete(0, target.length);
  if (value.length) target.insert(0, value);
}

export function applyDocumentSnapshot(
  doc: Y.Doc,
  snapshotInput: DocumentSnapshot,
  origin: unknown = "document-seed",
): void {
  const snapshot = validateDocumentSnapshot(snapshotInput);
  doc.transact(() => {
    const rootMap = root(doc);
    rootMap.set("schemaVersion", snapshot.schemaVersion);
    replaceText(text(rootMap, "title"), snapshot.content.title);
    replaceText(text(rootMap, "subtitle"), snapshot.content.subtitle ?? "");
    replaceText(text(rootMap, "body"), snapshot.content.body);
    replaceMap(map(rootMap, "fields"), snapshot.content.fields);
    replaceArray(array(rootMap, "tags"), snapshot.content.tags);
    replaceArray(array(rootMap, "assets"), snapshot.content.assets);
    const presentation = map(rootMap, "presentation");
    replaceMap(
      presentation,
      {
        templateId: snapshot.presentation.template.id,
        templateVersion: snapshot.presentation.template.version,
      },
      new Set(["theme"]),
    );
    replaceMap(map(presentation, "theme"), snapshot.presentation.theme);
  }, origin);
}

export function applyDocumentMutation(
  doc: Y.Doc,
  mutation: DocumentMutation,
  origin: unknown = "document-mutation",
): boolean {
  let applied = true;
  doc.transact(() => {
    const rootMap = root(doc);
    if (
      mutation.textRange !== undefined &&
      (mutation.title !== undefined ||
        mutation.subtitle !== undefined ||
        mutation.body !== undefined ||
        mutation.appendBody !== undefined ||
        mutation.bodySection !== undefined)
    ) {
      throw new Error("A text-range mutation cannot also replace text fields.");
    }
    if (mutation.body !== undefined && mutation.bodySection !== undefined) {
      throw new Error("A body mutation cannot also replace one section.");
    }
    // Validate a surgical edit before touching operation metadata or any
    // other field. Yjs transactions do not roll back after an exception.
    if (mutation.bodySection !== undefined) {
      const current = text(rootMap, "body");
      const updated = replaceMarkdownSectionBodyIfUnchanged(
        current.toString(),
        mutation.bodySection.heading,
        mutation.bodySection.expectedBody,
        mutation.bodySection.replacementBody,
      );
      if (updated === null) {
        throw new DocumentSectionConflictError();
      }
    }
    if (mutation.textRange !== undefined) {
      const current = text(rootMap, mutation.textRange.field).toString();
      const { start, end, expectedText } = mutation.textRange;
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < start ||
        end > current.length ||
        current.slice(start, end) !== expectedText
      ) {
        throw new DocumentTextRangeConflictError();
      }
    }
    const operations = map(rootMap, APPLIED_OPERATIONS_KEY);
    if (mutation.operationId && operations.has(mutation.operationId)) {
      applied = false;
      return;
    }
    if (mutation.title !== undefined) {
      replaceText(text(rootMap, "title"), mutation.title);
    }
    if (mutation.subtitle !== undefined) {
      replaceText(text(rootMap, "subtitle"), mutation.subtitle ?? "");
    }
    if (mutation.body !== undefined) {
      replaceText(text(rootMap, "body"), mutation.body);
    }
    if (mutation.appendBody !== undefined) {
      const fragment = mutation.appendBody.trim();
      if (fragment) {
        const body = text(rootMap, "body");
        const current = body.toString().trimEnd();
        if (current.length < body.length) {
          body.delete(current.length, body.length - current.length);
        }
        body.insert(body.length, current ? `\n\n${fragment}` : fragment);
      }
    }
    if (mutation.bodySection !== undefined) {
      replaceLiveBodySection(text(rootMap, "body"), mutation.bodySection);
    }
    if (mutation.textRange !== undefined) {
      replaceLiveTextRange(
        text(rootMap, mutation.textRange.field),
        mutation.textRange,
      );
    }
    if (mutation.tags !== undefined) {
      replaceArray(array(rootMap, "tags"), mutation.tags);
    }
    if (mutation.fields !== undefined) {
      const fields = map(rootMap, "fields");
      for (const [key, value] of Object.entries(mutation.fields)) {
        if (value === null) fields.delete(key);
        else fields.set(key, value);
      }
    }
    if (mutation.assets !== undefined) {
      replaceArray(array(rootMap, "assets"), mutation.assets);
    }
    if (mutation.template !== undefined) {
      // Presentation is a pinned reference, never a merged structure: two
      // concurrent look changes must resolve to one whole look, not a mix.
      const presentation = map(rootMap, "presentation");
      presentation.set("template", {
        id: mutation.template.id,
        version: mutation.template.version,
      });
    }
    if (mutation.operationId) {
      operations.set(mutation.operationId, Date.now());
      if (operations.size > MAX_APPLIED_OPERATIONS) {
        const oldest = Array.from(operations.entries())
          .map(([key, value]) => ({
            key,
            timestamp: typeof value === "number" ? value : 0,
          }))
          .sort(
            (left, right) =>
              left.timestamp - right.timestamp ||
              left.key.localeCompare(right.key),
          )
          .slice(0, operations.size - MAX_APPLIED_OPERATIONS);
        for (const entry of oldest) operations.delete(entry.key);
      }
    }
  }, origin);
  return applied;
}

function cleanFields(
  value: Record<string, unknown>,
): Record<string, DocumentFieldValue> {
  return value as Record<string, DocumentFieldValue>;
}

export function documentSnapshotFromYDoc(doc: Y.Doc): DocumentSnapshot {
  const rootMap = root(doc);
  const presentation = map(rootMap, "presentation");
  const storedTheme = presentation.get("theme");
  const theme =
    storedTheme instanceof Y.Map
      ? storedTheme.toJSON()
      : storedTheme &&
          typeof storedTheme === "object" &&
          !Array.isArray(storedTheme)
        ? storedTheme
        : {};
  return validateDocumentSnapshot({
    schemaVersion: 1,
    content: {
      title: text(rootMap, "title").toString(),
      subtitle: text(rootMap, "subtitle").toString() || undefined,
      body: text(rootMap, "body").toString(),
      fields: cleanFields(map(rootMap, "fields").toJSON()),
      tags: array(rootMap, "tags").toArray() as string[],
      assets: array(rootMap, "assets").toArray() as DocumentAsset[],
    },
    presentation: {
      template: {
        id: String(presentation.get("templateId") ?? "texttext.article"),
        version: Number(presentation.get("templateVersion") ?? 1),
      },
      theme,
    },
  });
}

export function createDocumentYDoc(snapshot?: DocumentSnapshot): Y.Doc {
  const doc = new Y.Doc();
  if (snapshot) applyDocumentSnapshot(doc, snapshot);
  return doc;
}

function stableSeedClientId(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 1;
}

/**
 * Encode the canonical snapshot as a deterministic Yjs baseline. The baseline
 * is persisted once per collaboration epoch. Determinism also lets an offline
 * client seed the same revision without creating a second independent text
 * history when it reconnects.
 */
export function encodeDocumentBaseline(
  snapshotInput: DocumentSnapshot,
  seed: string,
): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = stableSeedClientId(seed);
  try {
    applyDocumentSnapshot(doc, snapshotInput, "document-baseline");
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

export function applyDocumentBaseline(
  target: Y.Doc,
  snapshot: DocumentSnapshot,
  seed: string,
  origin: unknown = "document-baseline",
): void {
  Y.applyUpdate(target, encodeDocumentBaseline(snapshot, seed), origin);
}

export function hasDocumentSnapshot(doc: Y.Doc): boolean {
  return root(doc).get("schemaVersion") === 1;
}

export function documentText(
  doc: Y.Doc,
  key: "title" | "subtitle" | "body",
): Y.Text {
  return text(root(doc), key);
}

export function documentFields(doc: Y.Doc): Y.Map<unknown> {
  return map(root(doc), "fields");
}

export function documentTags(doc: Y.Doc): Y.Array<unknown> {
  return array(root(doc), "tags");
}

export function documentAssets(doc: Y.Doc): Y.Array<unknown> {
  return array(root(doc), "assets");
}

export function documentPresentation(doc: Y.Doc): Y.Map<unknown> {
  return map(root(doc), "presentation");
}

export function documentTheme(doc: Y.Doc): Y.Map<unknown> {
  return map(documentPresentation(doc), "theme");
}
