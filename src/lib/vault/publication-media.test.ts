import { describe, expect, it } from "vitest";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { changeVaultPublicationInPack, publishedVaultAsset } from "./publication";

const itemId = "item-1", workspaceId = "workspace-1";
const bmff = (brand: string) => Uint8Array.from([0, 0, 0, 20, 102, 116, 121, 112,
  ...brand.split("").map(char => char.charCodeAt(0)), 0, 0, 0, 0]);
function pack(extension: string, data: Uint8Array) {
  const reference = `assets/media.${extension}`;
  const document = emptyDocumentSnapshot();
  document.content.body = `![Media](${reference})`;
  document.content.assets = [{ id: "media", kind: "image", src: reference }];
  const original = buildTextpack("Media", { document,
    markdown: `---\ntextTextId: ${itemId}\n---\n\n${document.content.body}`,
    files: { [reference]: data } });
  return changeVaultPublicationInPack(original, true, "publish-1").bytes;
}

describe("published TextPack media", () => {
  it.each([
    ["avif", bmff("avif"), "image/avif"],
    ["heic", bmff("heic"), "image/heic"],
    ["heif", bmff("mif1"), "image/heif"],
    ["mov", bmff("qt  "), "video/quicktime"],
    ["m4v", bmff("M4V "), "video/x-m4v"],
    ["webm", Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), "video/webm"],
  ] as const)("serves a referenced %s asset with the expected media type", (extension, data, contentType) => {
    const bytes = pack(extension, data);
    const asset = publishedVaultAsset(bytes, workspaceId, itemId, `assets/media.${extension}`);
    expect(asset?.contentType).toBe(contentType);
    expect(asset?.data).toEqual(data);
    expect(publishedVaultAsset(pack(extension, new TextEncoder().encode("<html>")), workspaceId, itemId,
      `assets/media.${extension}`)).toBeNull();
  });

  it("does not serve an SVG even when a published document references it", () => {
    expect(publishedVaultAsset(pack("svg", new TextEncoder().encode("<svg onload='alert(1)'></svg>")),
      workspaceId, itemId, "assets/media.svg")).toBeNull();
  });
});
