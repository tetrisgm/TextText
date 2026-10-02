import { unzipSync, strFromU8 } from "fflate";
import sharp from "sharp";
import { emptyDocumentSnapshot, validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { parsePostMarkdownFile } from "@/lib/markdown-files";

export type VaultPreview = { metadataTruncated?: boolean; incompleteFields: string[]; document: DocumentSnapshot; title: string; excerpt: string; sourceURL?: string; image?: { data: string; contentType: string } };

/** No remote fetches or full asset transfer. Decode one local image, one frame. */
export async function previewTextpack(bytes: Uint8Array, metadataOnly = false): Promise<VaultPreview> {
  if (bytes.length > 64 * 1024 * 1024) throw new Error("TextPack exceeds preview limit");
  let expanded = 0;
  const metadata = unzipSync(bytes, { filter(entry) {
    if (!/(?:^|\/)(document\.json|text\.md)$/.test(entry.name)) return false;
    if ((expanded += entry.originalSize) > 4 * 1024 * 1024) throw new Error("TextPack metadata exceeds preview limit");
    return true;
  } });
  const documents = Object.keys(metadata).filter((key) => /(?:^|\/)document\.json$/.test(key));
  if (documents.length !== 1) throw new Error("TextPack requires one document");
  const prefix = documents[0].slice(0, -"document.json".length);
  const document = validateDocumentSnapshot(JSON.parse(strFromU8(metadata[documents[0]])));
  const markdown = metadata[prefix + "text.md"];
  const parsed = markdown ? parsePostMarkdownFile(strFromU8(markdown)) : null;
  const projection = emptyDocumentSnapshot(document.presentation.template);
  projection.content.subtitle = document.content.subtitle?.slice(0, 300);
  projection.content.tags = document.content.tags.slice(0, 100);
  for (const [key, value] of Object.entries(document.content.fields).slice(0, 64)) {
    if (key.length > 120) continue;
    if (typeof value === "string") projection.content.fields[key] = value.slice(0, 2048);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) projection.content.fields[key] = value;
  }
  const result: VaultPreview = {
    document: projection, incompleteFields: [],
    title: (parsed?.fields.title ?? document.content.title).slice(0, 240),
    excerpt: (parsed?.body ?? document.content.body).slice(0, 2000).replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim().slice(0, 400),
  };
  const incomplete: string[] = [];
  if ((parsed?.fields.title ?? document.content.title) !== result.title) incomplete.push("title");
  if (document.content.subtitle !== projection.content.subtitle) incomplete.push("subtitle");
  if ((parsed?.body ?? document.content.body) !== result.excerpt) incomplete.push("body");
  if (document.content.tags.length > 100) incomplete.push("tags");
  for (const [key, value] of Object.entries(document.content.fields)) {
    if (!Object.hasOwn(projection.content.fields, key) || projection.content.fields[key] !== value) incomplete.push(`content.fields.${key}`);
    if (incomplete.length > 2048) break;
  }
  result.incompleteFields = incomplete.length > 2048 ? ["*"] : incomplete;
  if (incomplete.length) result.metadataTruncated = true;
  projection.content.title = result.title; projection.content.body = result.excerpt;
  const source = document.content.fields.sourceUrl;
  if (typeof source === "string") {
    try { const url = new URL(source); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) result.sourceURL = url.href; } catch { /* Optional metadata. */ }
  }
  if (metadataOnly) return result;
  const asset = document.content.assets.find((asset) => asset.kind === "image");
  const reference = asset?.poster || asset?.src;
  if (!reference || !/^assets\/[A-Za-z0-9 _./-]+$/.test(reference) || reference.split("/").includes("..")) return result;
  try {
    const selected = prefix + reference;
    const files = unzipSync(bytes, { filter(entry) {
      if (entry.name !== selected) return false;
      if (entry.originalSize > 20 * 1024 * 1024) throw new Error("Image exceeds preview limit");
      return true;
    } });
    if (!files[selected]) return result;
    const data = files[selected];
    const ascii = (offset: number, length: number) => String.fromCharCode(...data.subarray(offset, offset + length));
    const raster = data[0] === 137 && ascii(1, 3) === "PNG" || data[0] === 255 && data[1] === 216 ||
      ["GIF87a", "GIF89a"].includes(ascii(0, 6)) || ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
    if (!raster) return result;
    const thumbnail = await sharp(files[selected], { limitInputPixels: 16_000_000, pages: 1, autoOrient: true })
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
    if (thumbnail.length <= 512 * 1024) result.image = { data: thumbnail.toString("base64"), contentType: "image/jpeg" };
  } catch { /* A bad image must not hide the readable note or original file. */ }
  return result;
}
