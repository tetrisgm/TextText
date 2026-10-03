import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { readDocument, readTemplate } from "@/local-vault/model";
import { packIdentity } from "@/local-vault/pack";
import type { TemplateDefinition } from "@/lib/presentation/schema";

const fixedDate = new Date(1980, 0, 1);
const MAX_PACK = 64 * 1024 * 1024;
const MAX_EXPANDED = 256 * 1024 * 1024;
const MAX_METADATA = 16 * 1024 * 1024;
const MAX_ASSET = 64 * 1024 * 1024;
const markerLeaf = "publication.json";
const operationIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export type VaultPublication = { schemaVersion: 1; status: "public"; publishedAt: string; operationId: string };

function validEntry(name: string): boolean {
  return !!name && !name.startsWith("/") && !name.includes("\\") &&
    !name.split("/").some(part => part === ".." || part === "." || /[\x00-\x1f]/.test(part));
}

function scan(bytes: Uint8Array, selected: (name: string) => boolean, maximum = MAX_METADATA) {
  if (!bytes.length || bytes.length > MAX_PACK) throw new Error("Invalid TextPack size");
  let count = 0, expanded = 0;
  const seen = new Set<string>();
  const files = unzipSync(bytes, { filter(entry) {
    if (++count > 10_000 || !validEntry(entry.name) || seen.has(entry.name)) throw new Error("Invalid TextPack entry");
    seen.add(entry.name);
    if (!selected(entry.name)) return false;
    if ((expanded += entry.originalSize) > maximum) throw new Error("TextPack selection exceeds limit");
    return true;
  } });
  const documents = [...seen].filter(name => name === "document.json" || name.endsWith("/document.json"));
  if (documents.length !== 1) throw new Error("TextPack requires one document");
  return { files, prefix: documents[0].slice(0, -"document.json".length) };
}

/** Compare every publication entry, including misplaced ones, during generic writes. */
export function publicationEntries(bytes: Uint8Array): Record<string, Uint8Array> {
  const { files } = scan(bytes, name => name === markerLeaf || name.endsWith(`/${markerLeaf}`), 4096);
  return files;
}

export function samePublicationEntries(before: Uint8Array | null, after: Uint8Array): boolean {
  const left = before ? publicationEntries(before) : {};
  const right = publicationEntries(after);
  const names = Object.keys(left);
  return names.length === Object.keys(right).length && names.every(name => {
    const a = left[name], b = right[name];
    return !!b && a.length === b.length && a.every((byte, index) => byte === b[index]);
  });
}

function parseMarker(value: Uint8Array | undefined): VaultPublication | null {
  if (!value || value.length > 4096) return null;
  try {
    const parsed: unknown = JSON.parse(strFromU8(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const marker = parsed as Record<string, unknown>;
    if (Object.keys(marker).sort().join(",") !== "operationId,publishedAt,schemaVersion,status" ||
      marker.schemaVersion !== 1 || marker.status !== "public" ||
      typeof marker.operationId !== "string" || !operationIdPattern.test(marker.operationId) ||
      typeof marker.publishedAt !== "string" || Number.isNaN(Date.parse(marker.publishedAt)) ||
      new Date(marker.publishedAt).toISOString() !== marker.publishedAt) return null;
    return marker as VaultPublication;
  } catch { return null; }
}

export function readVaultPublicationFromPack(bytes: Uint8Array): VaultPublication | null {
  const { files, prefix } = scan(bytes, name => name === markerLeaf || name.endsWith(`/${markerLeaf}`), 4096);
  const names = Object.keys(files);
  return names.length === 1 && names[0] === prefix + markerLeaf ? parseMarker(files[names[0]]) : null;
}

/** Only this explicit operation may change publication.json. All other entries survive. */
export function changeVaultPublicationInPack(bytes: Uint8Array, published: boolean, operationId: string) {
  if (!operationIdPattern.test(operationId)) throw new Error("Invalid publication operation");
  if (!bytes.length || bytes.length > MAX_PACK) throw new Error("Invalid TextPack size");
  let count = 0, expanded = 0;
  const seen = new Set<string>();
  const entries = unzipSync(bytes, { filter(entry) {
    if (++count > 10_000 || !validEntry(entry.name) || seen.has(entry.name) ||
      (expanded += entry.originalSize) > MAX_EXPANDED) throw new Error("Invalid TextPack entry");
    seen.add(entry.name);
    return !entry.name.endsWith("/");
  } });
  const documents = Object.keys(entries).filter(name => name === "document.json" || name.endsWith("/document.json"));
  if (documents.length !== 1) throw new Error("TextPack requires one document");
  const prefix = documents[0].slice(0, -"document.json".length);
  const markerName = prefix + markerLeaf;
  const markerNames = Object.keys(entries).filter(name => name === markerLeaf || name.endsWith(`/${markerLeaf}`));
  const current = markerNames.length === 1 && markerNames[0] === markerName ? parseMarker(entries[markerName]) : null;
  if (published && markerNames.length && !current) throw new Error("Invalid publication marker. Unpublish first.");
  if (published === !!current && (published || markerNames.length === 0)) return { bytes, changed: false };
  for (const name of markerNames) delete entries[name];
  if (published) entries[markerName] = strToU8(JSON.stringify({ schemaVersion: 1, status: "public",
    publishedAt: new Date().toISOString(), operationId } satisfies VaultPublication));
  const next = zipSync(Object.fromEntries(Object.keys(entries).sort().map(name =>
    [name, [entries[name], { level: 0, mtime: fixedDate }]])), { level: 0, mtime: fixedDate });
  if (next.length > MAX_PACK) throw new Error("TextPack exceeds publication limit");
  return { bytes: next, changed: true };
}

function safeAssetPath(value: string): boolean {
  return value.startsWith("assets/") && value.length <= 1000 && !/[?#\\\x00-\x1f]/.test(value) &&
    value.split("/").every(part => part && part !== "." && part !== ".." && !part.startsWith("."));
}

function itemBindings(template: TemplateDefinition): Set<string> {
  const result = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string" && value.startsWith("content.")) result.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(template.item);
  return result;
}

function referencedAssets(document: DocumentSnapshot): Set<string> {
  const paths = new Set<string>();
  const add = (value: string) => { if (safeAssetPath(value)) paths.add(value); };
  for (const asset of document.content.assets) { add(asset.src); if (asset.poster) add(asset.poster); }
  const findMarkdown = (value: string) => {
    for (const match of value.matchAll(/!?\[[^\]]*\]\(<?(assets\/[^\s)<>]+)>?(?:\s+[^)]*)?\)/g)) add(match[1]);
  };
  findMarkdown(document.content.body);
  for (const value of Object.values(document.content.fields)) if (typeof value === "string") findMarkdown(value);
  return paths;
}

function assetUrl(workspaceId: string, itemId: string, value: string): string {
  return `/api/public/vault/${encodeURIComponent(workspaceId)}/${encodeURIComponent(itemId)}/assets/${value.slice("assets/".length).split("/").map(encodeURIComponent).join("/")}`;
}

export function publishedVaultView(bytes: Uint8Array, workspaceId: string, itemId: string): {
  document: DocumentSnapshot; template: TemplateDefinition; publication: VaultPublication; assetPaths: Set<string>;
  preview: { title: string; subtitle: string; imageUrl?: string };
} | null {
  const publication = readVaultPublicationFromPack(bytes);
  if (!publication) return null;
  const { files, prefix } = scan(bytes, name => /(?:^|\/)(document\.json|text\.md|template\.json)$/.test(name), MAX_METADATA);
  const markdown = files[prefix + "text.md"], documentJSON = files[prefix + "document.json"];
  if (!markdown || !documentJSON) return null;
  if (packIdentity(strFromU8(markdown)) !== itemId) return null;
  // The editor's validated document projection is also used by the public reader.
  validateDocumentSnapshot(JSON.parse(strFromU8(documentJSON)));
  const file = { path: "", hash: "", markdown: strFromU8(markdown), documentJSON: strFromU8(documentJSON),
    templateJSON: files[prefix + "template.json"] ? strFromU8(files[prefix + "template.json"]) : null,
    templateAuthoringSourceJSON: null, assets: [] };
  const document = readDocument(file);
  const template = readTemplate(file, document);
  const bindings = itemBindings(template);
  const fields = Object.fromEntries(Object.entries(document.content.fields)
    .filter(([key]) => bindings.has(`content.fields.${key}`)));
  const tags = bindings.has("content.tags") ? document.content.tags : [];
  const visibleText = [document.content.body, document.content.subtitle ?? "", ...Object.values(fields)
    .filter((value): value is string => typeof value === "string")].join("\n");
  const assets = bindings.has("content.assets") ? document.content.assets : document.content.assets.filter(asset =>
    visibleText.includes(asset.src) || Boolean(asset.poster && visibleText.includes(asset.poster)));
  const projected = validateDocumentSnapshot({ ...document, content: { ...document.content, fields, tags, assets } });
  const assetPaths = referencedAssets(projected);
  const customTitle = document.content.fields.texttextPreviewTitle;
  const customSubtitle = document.content.fields.texttextPreviewSubtitle;
  const featured = document.content.fields.texttextFeaturedImage;
  const image = document.content.assets.find(asset => asset.kind === "image" && asset.src === featured &&
    (document.content.body.includes(asset.src) || document.content.fields.cover === asset.src))
    ?? document.content.assets.find(asset => asset.kind === "image" &&
      (document.content.body.includes(asset.src) || document.content.fields.cover === asset.src));
  const previewImage = image && assetPaths.has(image.src) && /\.(?:png|jpe?g|gif|webp)$/i.test(image.src)
    ? assetUrl(workspaceId, itemId, image.src) : undefined;
  const preview = {
    title: typeof customTitle === "string" && customTitle.trim() ? customTitle.trim() : document.content.title.trim(),
    subtitle: typeof customSubtitle === "string" ? customSubtitle.trim() : document.content.subtitle?.trim() || "",
    ...(previewImage ? { imageUrl: previewImage } : {}),
  };
  const substitutions = [...assetPaths].sort((a, b) => b.length - a.length)
    .map(value => [value, assetUrl(workspaceId, itemId, value)] as const);
  const replace = (value: unknown): unknown => {
    if (typeof value === "string") return substitutions.reduce((text, [source, target]) => text.split(source).join(target), value);
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
    return value;
  };
  // The public item renderer uses only the item tree, its bound field definitions, and theme.
  // Starter/example content and collection layouts belong to the private template editor.
  const publicTemplate: TemplateDefinition = { ...template, name: "Published look", description: undefined,
    starter: undefined, example: undefined,
    fields: template.fields.filter(field => bindings.has(`content.fields.${field.id}`))
      .map(field => ({ ...field, help: undefined })),
    collection: { layout: "list", columns: 1, gap: "md", sort: [], filters: [], views: [],
      item: { type: "text", bind: "content.title", role: "title" } } };
  return { document: validateDocumentSnapshot(replace(projected)), template: publicTemplate, publication, assetPaths, preview };
}

export function publishedVaultAsset(bytes: Uint8Array, workspaceId: string, itemId: string, assetPath: string) {
  if (!safeAssetPath(assetPath)) return null;
  const view = publishedVaultView(bytes, workspaceId, itemId);
  if (!view?.assetPaths.has(assetPath)) return null;
  const extension = assetPath.split(".").at(-1)?.toLowerCase();
  const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", avif: "image/avif", heic: "image/heic", heif: "image/heif",
    mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", webm: "video/webm",
    mp3: "audio/mpeg", wav: "audio/wav", pdf: "application/pdf" };
  const contentType = extension ? types[extension] : undefined;
  if (!contentType) return null;
  const { files, prefix } = scan(bytes, name => name.endsWith(`/${assetPath}`), MAX_ASSET);
  const data = files[prefix + assetPath];
  if (!data?.length) return null;
  const ascii = (offset: number, length: number) => String.fromCharCode(...data.subarray(offset, offset + length));
  const bmff = data.length >= 12 && ascii(4, 4) === "ftyp";
  const brands = ascii(8, Math.min(32, Math.max(0, data.length - 8))).toLowerCase();
  const valid = contentType === "image/png" ? data[0] === 137 && ascii(1, 3) === "PNG"
    : contentType === "image/jpeg" ? data[0] === 255 && data[1] === 216
      : contentType === "image/gif" ? ["GIF87a", "GIF89a"].includes(ascii(0, 6))
        : contentType === "image/webp" ? ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP"
          : contentType === "image/avif" ? bmff && /avif|avis/.test(brands)
            : contentType === "image/heic" || contentType === "image/heif" ? bmff && /heic|heix|hevc|hevx|mif1|msf1/.test(brands)
              : contentType === "video/mp4" || contentType === "video/x-m4v" ? bmff
                : contentType === "video/quicktime" ? bmff || ["moov", "mdat", "wide", "free"].includes(ascii(4, 4))
                  : contentType === "video/webm" ? data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3
                    : contentType === "audio/mpeg" ? ascii(0, 3) === "ID3" || data[0] === 0xff && (data[1] & 0xe0) === 0xe0
                      : contentType === "audio/wav" ? ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE"
                        : contentType === "application/pdf" ? ascii(0, 5) === "%PDF-" : false;
  if (!valid) return null;
  return { data, contentType, download: contentType === "application/pdf" };
}
