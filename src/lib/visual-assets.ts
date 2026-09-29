import sharp, { type Metadata } from "sharp";

export const MAX_VISUAL_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_VISUAL_PIXELS = 40_000_000;

const CONTENT_TYPES: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export type PreparedVisualAsset = {
  original: Buffer;
  originalContentType: string;
  preview: Buffer;
  width: number;
  height: number;
  previewWidth: number;
  previewHeight: number;
};

/** Read one bounded image, preserve its bytes, and make a static grid preview. */
export async function prepareVisualAsset(file: Pick<File, "name" | "size" | "arrayBuffer">): Promise<PreparedVisualAsset> {
  if (file.size === 0) throw new Error("Choose a nonempty image.");
  if (file.size > MAX_VISUAL_ASSET_BYTES) throw new Error("Images must be 50 MB or smaller.");
  const original = Buffer.from(await file.arrayBuffer());
  if (original.byteLength !== file.size || original.byteLength > MAX_VISUAL_ASSET_BYTES) {
    throw new Error("Image size changed during upload.");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(original, { animated: false, limitInputPixels: MAX_VISUAL_PIXELS }).metadata();
  } catch {
    throw new Error("This image could not be read.");
  }
  const originalContentType = CONTENT_TYPES[metadata.format ?? ""];
  const width = metadata.autoOrient?.width ?? metadata.width;
  const height = metadata.autoOrient?.height ?? metadata.height;
  if (!originalContentType || !width || !height || width * height > MAX_VISUAL_PIXELS) {
    throw new Error("Use a JPEG, PNG, WebP, GIF, or AVIF image under 40 megapixels.");
  }

  // A very tall screenshot gets a legible top section in the grid. The viewer
  // always opens the uncropped original. GIFs are decoded as a single frame.
  const tall = height > width * 2;
  let preview: Buffer;
  let previewWidth: number;
  let previewHeight: number;
  try {
    let pipeline = sharp(original, { animated: false, limitInputPixels: MAX_VISUAL_PIXELS }).rotate();
    if (tall) {
      pipeline = pipeline.extract({ left: 0, top: 0, width, height: Math.min(height, width * 2) });
    }
    const result = await pipeline
      .resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 74, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    preview = result.data;
    previewWidth = result.info.width;
    previewHeight = result.info.height;
  } catch {
    throw new Error("This image preview could not be prepared.");
  }
  return { original, originalContentType, preview, width, height, previewWidth, previewHeight };
}

export function visualAssetFilename(name: string, contentType: string): string {
  const extension = contentType === "image/jpeg" ? "jpg" : contentType.slice("image/".length);
  const stem = name.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]+$/, "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "image";
  return `${stem}.${extension}`;
}
