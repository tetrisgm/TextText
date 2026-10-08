import { createHash } from "node:crypto";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { DocumentMutation } from "@/lib/collab/document";
import type { PreparedVisualAsset } from "@/lib/visual-assets";
import type { PackAssetAddition } from "@/local-vault/pack";
export type AssetCommand = { sourceUrl: string; placement: "cover" | "body_end" | "gallery"; altText?: string; caption?: string };
export type VaultAssetAttachment = { request: AssetCommand; prepare: () => Promise<PreparedVisualAsset> };
export function assetCommandPayload(document: DocumentSnapshot, request: AssetCommand, prepared: PreparedVisualAsset, operationId: string): { mutation: DocumentMutation; additions: PackAssetAddition[] } {
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" }[prepared.originalContentType];
  if (!extension || !prepared.original.length || !prepared.preview.length) throw new Error("Invalid prepared image");
  const id = `image-${createHash("sha256").update(operationId).update(prepared.original).digest("hex").slice(0, 40)}`;
  const filename = `${id}.${extension}`, poster = `${id}-preview.webp`, src = `assets/${filename}`;
  const asset = { id, kind: "image" as const, src, poster: `assets/${poster}`, contentType: prepared.originalContentType, width: prepared.width, height: prepared.height, sourceUrl: request.sourceUrl, ...(request.altText !== undefined ? { alt: request.altText } : {}), ...(request.caption !== undefined ? { caption: request.caption } : {}) };
  const mutation: DocumentMutation = { assets: [...document.content.assets, asset] };
  if (request.placement === "cover") mutation.fields = { cover: src, coverCaption: request.caption ?? null };
  if (request.placement === "body_end") {
    const alt = (request.altText ?? "Image").replace(/[\\[\]\r\n]/g, " ");
    mutation.appendBody = `![${alt}](${src})`;
  }
  return { mutation, additions: [{ filename, data: prepared.original, contentType: prepared.originalContentType, remoteURL: request.sourceUrl }, { filename: poster, data: prepared.preview, contentType: "image/webp" }] };
}
