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

export function encodeImagePack(bytes: Uint8Array, name: string, preview?: { bytes: Uint8Array; width: number; height: number }): { bytes: Uint8Array; title: string } {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Choose an image no larger than 20 MiB.");
  const { extension, contentType } = imageType(bytes);
  const title = name.replace(/\.[^.]+$/, "").trim().slice(0, 120) || "Image";
  const template = BUILTIN_TEMPLATES.find((entry) => entry.id === "texttext.gallery")!;
  const document = emptyDocumentSnapshot({ id: template.id, version: template.version });
  document.content.title = title;
  document.content.assets = [{ id: crypto.randomUUID(), kind: "image", src: `assets/original.${extension}`, alt: title, contentType }];
  if (preview) Object.assign(document.content.assets[0], { poster: "assets/preview.png", width: preview.width, height: preview.height });
  validateDocumentSnapshot(document);
  const pack = emptyPack();
  pack.entries[`${pack.prefix}assets/original.${extension}`] = bytes;
  if (preview) pack.entries[pack.prefix + "assets/preview.png"] = preview.bytes;
  const file = { path: `${title}.textpack`, hash: "", markdown: `---\ntextTextId: "${crypto.randomUUID()}"\n---\n\n`, templateJSON: JSON.stringify(template) };
  return { title, bytes: encodePack(pack, writePayload(file, document)) };
}

/** Keep GIFs still in grids. Decode only one bounded image at a time, and release
 * the bitmap/canvas before the original bytes are sent across the native bridge. */
export async function prepareImagePack(bytes: Uint8Array, name: string) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Choose an image no larger than 20 MiB.");
  if (imageType(bytes).contentType !== "image/gif") return encodeImagePack(bytes, name);
  // GIF89a logical screen descriptor: little-endian width and height follow
  // the six-byte signature. https://www.w3.org/Graphics/GIF/spec-gif89a.txt
  const width = bytes[6] | bytes[7] << 8, height = bytes[8] | bytes[9] << 8;
  if (!width || !height || width * height > 8_000_000) throw new Error("Choose a GIF with a canvas of at most 8 million pixels.");
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/gif" }));
  const image = new Image();
  const canvas = document.createElement("canvas");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("This GIF could not be previewed. Try another image.")), 10_000);
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("This GIF could not be decoded."));
      image.src = url;
    });
    const scale = Math.min(1, 1024 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image preview is unavailable.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Image preview could not be saved.")), "image/png"));
    return encodeImagePack(bytes, name, { bytes: new Uint8Array(await blob.arrayBuffer()), width, height });
  } finally {
    clearTimeout(timer);
    image.onload = null; image.onerror = null; image.src = "";
    URL.revokeObjectURL(url);
    canvas.width = 0; canvas.height = 0;
  }
}

export function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(chunks.join(""));
}
