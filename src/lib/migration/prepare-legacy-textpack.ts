import { replacePackIdentity } from "@/local-vault/pack";
import { isUuid, renderSyncDocumentFile } from "@/app/api/sync/v1/sync";
import type { Blog, Post } from "@/lib/content";
import { requireDocumentSnapshot } from "@/lib/documents/model";
import { buildTextpack, sha256Hex } from "@/lib/github/textpack";
import type { AuthoringSource } from "@/lib/presentation/authoring-source";
import { templateDefinitionSchema, type TemplateDefinition } from "@/lib/presentation/schema";
import { validatedLookSource } from "@/lib/presentation/template-library";

export type LegacyExportAsset = { source: string; path: string; bytes: Uint8Array; contentType: string };
function safePath(path: string) {
  return !!path && !/[\\\x00-\x1f:*?"<>|]/.test(path) && path.split("/").every(part => !!part && part !== "." && part !== ".." && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

/** Preparation only: callers must inventory grants/comments and resolve every asset before cutover. */
export function prepareLegacyTextpack(input: {
  blog: Blog; post: Post; path: string; folderPath: string;
  template?: TemplateDefinition; templateAuthoringSource?: AuthoringSource;
  assets: readonly LegacyExportAsset[];
  /** Required inventory result. Comments cannot yet be imported losslessly. */
  comments: readonly unknown[];
}) {
  const { post } = input;
  if (!post.id || !isUuid(post.id)) throw new Error("Legacy item requires its original UUID");
  if (!safePath(input.path) || !input.path.endsWith(".textpack") || !safePath(input.folderPath)) throw new Error("Unsafe migration path");
  if (!Array.isArray(input.comments) || input.comments.length) throw new Error("Comment metadata requires a supported migration before export");
  const document = requireDocumentSnapshot(post.document, "Legacy migration");
  // Inline Markdown/HTML media needs its own resolver; do not claim an offline-complete export.
  if (/!\[|<(?:img|video|audio|source|iframe)\b/i.test(document.content.body)) throw new Error("Inline media requires a supported migration resolver");
  const reference = document.presentation.template;
  const template = input.template ? templateDefinitionSchema.parse(input.template) : undefined;
  if (reference && (!template || template.id !== reference.id || template.version !== reference.version)) throw new Error("Missing matching template");
  if (input.templateAuthoringSource && !template) throw new Error("Authoring source requires a template");
  const source = template ? validatedLookSource(template, input.templateAuthoringSource) : undefined;
  const files: Record<string, Uint8Array> = {};
  const mappings: Record<string, { url: string; contentType: string }> = {};
  const sources = new Set<string>();
  const paths = new Set<string>();
  for (const asset of input.assets) {
    if (!safePath(asset.path) || !asset.path.startsWith("assets/") || paths.has(asset.path.toLowerCase()) || sources.has(asset.source)) throw new Error("Unsafe or duplicate asset path/source");
    if (!(asset.bytes instanceof Uint8Array) || !asset.bytes.byteLength || !asset.source || !asset.contentType) throw new Error("Missing asset bytes or metadata");
    paths.add(asset.path.toLowerCase()); sources.add(asset.source);
    files[asset.path] = asset.bytes;
    mappings[asset.path.slice(7)] = { url: asset.source, contentType: asset.contentType };
  }
  for (const asset of document.content.assets) {
    for (const source of [asset.src, asset.poster].filter((value): value is string => !!value)) {
      if (!sources.has(source)) throw new Error(`Missing bytes for asset ${asset.id}`);
    }
  }
  const rendered = JSON.parse(renderSyncDocumentFile(input.blog, post, input.folderPath, template, source).text);
  const identified = replacePackIdentity(rendered.markdown, post.id);
  const header = identified.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
  if (!header) throw new Error("Missing migration frontmatter");
  // The legacy renderer normalizes body whitespace. The file editor reads it
  // verbatim, so emit its exact separator and preserve the canonical body.
  const markdown = `${header}\n${document.content.body}`;
  const name = input.path.split("/").at(-1)!.slice(0, -9);
  const bytes = buildTextpack(name, { markdown, document, template, templateAuthoringSource: source, files, info: { "net.texttext.assets": mappings } });
  return { itemId: post.id, path: input.path, bytes, hash: sha256Hex(bytes), sourceRevision: post.revision ?? null };
}
