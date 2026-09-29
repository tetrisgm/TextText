import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MAX_VISUAL_ASSET_BYTES, prepareVisualAsset, visualAssetFilename } from "../visual-assets";

function file(name: string, bytes: Buffer) {
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

describe("visual asset preparation", () => {
  it("keeps the animated original and makes one bounded still frame", async () => {
    const bytes = await readFile("public/travolta-looking-around.gif");
    const prepared = await prepareVisualAsset(file("reference.gif", bytes));
    const preview = await sharp(prepared.preview).metadata();

    expect(prepared.original.equals(bytes)).toBe(true);
    expect(prepared.originalContentType).toBe("image/gif");
    expect(preview.format).toBe("webp");
    expect(preview.pages ?? 1).toBe(1);
    expect(prepared.width).toBe(480);
    expect(prepared.height).toBe(204);
  });

  it("uses a readable top preview for a long screenshot", async () => {
    const bytes = await sharp({ create: { width: 200, height: 1600, channels: 3, background: "#efece8" } }).png().toBuffer();
    const prepared = await prepareVisualAsset(file("long.png", bytes));
    expect(prepared.width).toBe(200);
    expect(prepared.height).toBe(1600);
    expect(prepared.previewHeight / prepared.previewWidth).toBeLessThanOrEqual(2);

    const rotated = await sharp({ create: { width: 1600, height: 200, channels: 3, background: "#efece8" } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const portrait = await prepareVisualAsset(file("rotated.jpg", rotated));
    expect(portrait.width).toBe(200);
    expect(portrait.height).toBe(1600);
    expect(portrait.previewHeight / portrait.previewWidth).toBeLessThanOrEqual(2);
  });

  it("rejects disguised files and oversized images before storing them", async () => {
    const html = Buffer.from("<html>not an image</html>");
    await expect(prepareVisualAsset(file("photo.jpg", html))).rejects.toThrow("could not be read");
    await expect(prepareVisualAsset({
      name: "huge.gif",
      size: MAX_VISUAL_ASSET_BYTES + 1,
      arrayBuffer: async () => { throw new Error("must not read"); },
    })).rejects.toThrow("50 MB");
    expect(visualAssetFilename("../Blue Sky.exe", "image/png")).toBe("blue-sky.png");
  });
});
