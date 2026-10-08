import type { VaultFile } from "./bridge";
import { readDocument } from "./model";

type Attachment = { name: string; mediaType: string; dataUrl: string };
async function prepareImage(data: string, mediaType: string): Promise<Attachment> {
  if (!/^image\/(jpeg|png|webp|gif|avif|heic|heif)$/i.test(mediaType) || data.length > 32 * 1024 * 1024) throw new Error("This image cannot be prepared for the assistant.");
  const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
  const image = await createImageBitmap(new Blob([bytes], { type: mediaType }));
  try {
    if (!image.width || !image.height || image.width * image.height > 64_000_000) throw new Error("This image is too large for the assistant.");
    const ratio = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext("2d"); if (!context) throw new Error("The image preview could not be prepared.");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
    if (dataUrl.length > 1_000_000 || !dataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("This image is too large for the assistant.");
    return { name: "Selected photo.jpg", mediaType: "image/jpeg", dataUrl };
  } finally { image.close(); }
}

/** Only embedded bytes for the exact selected asset. Never fetch its source URL. */
export async function galleryAgentImage(file: VaultFile, id: unknown, prepare = prepareImage): Promise<Attachment> {
  if (typeof id !== "string" || !id || id.length > 120) throw new Error("Choose a photo before asking the assistant.");
  const matches = readDocument(file).content.assets.filter(asset => asset.id === id && asset.kind === "image");
  if (matches.length !== 1) throw new Error("The selected photo changed. Reopen it before asking the assistant.");
  const image = matches[0];
  const embedded = (file.assets ?? []).filter(asset => image.src === `assets/${asset.filename}` || !!asset.remoteURL && image.src === asset.remoteURL);
  if (embedded.length !== 1) throw new Error("The selected photo's original image is unavailable.");
  return prepare(embedded[0].data, embedded[0].contentType);
}
