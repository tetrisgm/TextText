import { strToU8 } from "fflate";
import { emptyDocumentSnapshot, validateDocumentSnapshot } from "@/lib/documents/model";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { emptyPack, encodePack } from "./pack";
import { writePayload } from "./model";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

// Check the stored bytes, rather than trusting an extension or clipboard MIME.
function imageType(bytes: Uint8Array): { extension: string; contentType: string } {
  const starts = (signature: number[]) => signature.every((value, index) => bytes[index] === value);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return { extension: "png", contentType: "image/png" };
  if (starts([255, 216, 255])) return { extension: "jpg", contentType: "image/jpeg" };
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return { extension: "gif", contentType: "image/gif" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return { extension: "webp", contentType: "image/webp" };
  throw new Error("Choose a PNG, JPEG, GIF or WebP image.");
}

export function encodeImagePack(bytes: Uint8Array, name: string): { bytes: Uint8Array; title: string } {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Choose an image no larger than 20 MiB.");
  const { extension, contentType } = imageType(bytes);
  const title = name.replace(/\.[^.]+$/, "").trim().slice(0, 120) || "Image";
  const template = BUILTIN_TEMPLATES.find((entry) => entry.id === "texttext.gallery")!;
  const document = emptyDocumentSnapshot({ id: template.id, version: template.version });
  document.content.title = title;
  document.content.assets = [{ id: crypto.randomUUID(), kind: "image", src: `assets/original.${extension}`, alt: title, contentType }];
  validateDocumentSnapshot(document);
  const pack = emptyPack();
  pack.entries[`${pack.prefix}assets/original.${extension}`] = bytes;
  pack.entries[pack.prefix + "info.json"] = strToU8(JSON.stringify({ version: 2, type: "net.daringfireball.markdown", creatorIdentifier: "app.texttext", "net.texttext.assets": { [`original.${extension}`]: { contentType } } }));
  const file = { path: `${title}.textpack`, hash: "", markdown: `---\ntextTextId: "${crypto.randomUUID()}"\n---\n\n`, templateJSON: JSON.stringify(template) };
  return { title, bytes: encodePack(pack, writePayload(file, document)) };
}

export function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(chunks.join(""));
}
