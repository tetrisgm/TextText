import { emptyDocumentSnapshot, validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { mergeMarkdownIntoDocument } from "@/lib/documents/sync";
import { legacyProjectionFromDocument } from "@/lib/documents/legacy";
import { parsePostMarkdownFile, renderPostMarkdownFile } from "@/lib/markdown-files";
import { getBuiltinTemplate } from "@/lib/presentation/templates";
import { validateTemplateDefinition, type TemplateDefinition } from "@/lib/presentation/schema";
import type { Blog, Post } from "@/lib/content";
import type { VaultFile } from "./bridge";
import { reconcileDocumentSnapshots } from "@/lib/vault/reconcile";
export const localBlog: Blog = { handle: "local", name: "Workspace", author: "", homeLayout: "list" };
export class VaultRepresentationConflict extends Error {
  constructor() { super("text.md and document.json contain competing edits. Both representations are preserved in the file."); }
}
function patchChanged(before: unknown, after: unknown, target: unknown): unknown {
  if (JSON.stringify(before) === JSON.stringify(after)) return target;
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  if (object(before) && object(after) && object(target)) {
    const result = { ...target };
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!(key in after)) delete result[key];
      else result[key] = patchChanged(before[key], after[key], target[key]);
    }
    return result;
  }
  return after;
}
export function readDocument(file: VaultFile, previous?: VaultFile, previousDocument?: DocumentSnapshot): DocumentSnapshot {
  const seed = file.documentJSON ? validateDocumentSnapshot(JSON.parse(file.documentJSON)) : emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
  const parsed = parsePostMarkdownFile(file.markdown);
  // Vault writes add exactly one separator line. Preserve authored leading
  // blank lines and trailing spaces instead of normalizing the saved body.
  const body = file.markdown.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n(?:\r?\n)?([\s\S]*)$/)?.[1];
  if (body !== undefined) parsed.body = body;
  if (!previous) return mergeMarkdownIntoDocument(seed, parsed);
  const base = previousDocument ?? readDocument(previous);
  const priorStructured = previous.documentJSON ? validateDocumentSnapshot(JSON.parse(previous.documentJSON)) : base;
  const jsonVersion = validateDocumentSnapshot(patchChanged(priorStructured, seed, base));
  const markdownVersion = previous.markdown === file.markdown ? base : mergeMarkdownIntoDocument(base, parsed);
  const result = reconcileDocumentSnapshots(base, jsonVersion, markdownVersion);
  if (result.status === "conflict") throw new VaultRepresentationConflict();
  return result.document;
}
export function readTemplate(file: VaultFile, document: DocumentSnapshot) {
  if (file.templateJSON) {
    const candidate = validateTemplateDefinition(JSON.parse(file.templateJSON));
    if (candidate.id === document.presentation.template.id && candidate.version === document.presentation.template.version) return candidate;
  }
  const builtin = getBuiltinTemplate(document.presentation.template.id, document.presentation.template.version);
  if (!builtin) throw new Error("This TextPack is missing its template.json definition.");
  return builtin;
}
export function asPost(document: DocumentSnapshot, path: string): Post {
  const projected = legacyProjectionFromDocument(document);
  return { ...projected, accent: projected.accent ?? undefined, cover: projected.cover ?? undefined,
    coverCaption: projected.coverCaption ?? undefined, coverHeight: projected.coverHeight ?? undefined,
    videoUrl: projected.videoUrl ?? undefined, venue: projected.venue ?? undefined, duration: projected.duration ?? undefined,
    links: projected.links ?? undefined, id: path, slug: path, type: "note", status: "draft", document };
}
export type VaultTemplateSelection = { template: TemplateDefinition; sourceJSON?: string | null };
export function writePayload(file: VaultFile, document: DocumentSnapshot, look?: VaultTemplateSelection | null) {
  const template = look?.template ?? readTemplate(file, document);
  if (template.id !== document.presentation.template.id || template.version !== document.presentation.template.version) throw new Error("The selected template does not match this document.");
  const projection = renderPostMarkdownFile({ blog: localBlog, post: asPost(document, file.path) });
  const header = projection.match(/^---\n([\s\S]*?)\n---\n/)![1];
  const markdown = `---\n${header}\nexcerpt: ${JSON.stringify(document.content.subtitle ?? "")}\n---\n\n${document.content.body}`;
  // Retain file identity and other authored metadata that the projection does
  // not emit. TextPack frontmatter is deliberately one key per line.
  const prior = file.markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? "";
  const preservedKeys = new Set(parsePostMarkdownFile(file.markdown).unknownKeys);
  const preserved = prior.split(/\r?\n/).filter((line) => { const key = line.match(/^([A-Za-z][A-Za-z0-9_-]*):/)?.[1]; return key && preservedKeys.has(key); });
  return {
    path: file.path, hash: file.hash,
    markdown: preserved.length ? markdown.replace(/^---\n/, `---\n${preserved.join("\n")}\n`) : markdown,
    documentJSON: JSON.stringify(document),
    templateJSON: JSON.stringify(template),
    templateAuthoringSourceJSON: look ? look.sourceJSON ?? null : file.templateAuthoringSourceJSON ?? null,
  };
}
