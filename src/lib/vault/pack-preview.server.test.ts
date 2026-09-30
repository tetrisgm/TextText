import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { previewTextpack } from "./pack-preview.server";

describe("TextPack folder previews", () => {
  it("uses current markdown and a bounded still from embedded image bytes", async () => {
    const document = emptyDocumentSnapshot();
    document.content.title = "Old title"; document.content.body = "Old body";
    document.content.assets = [{ id: "photo", kind: "image", src: "assets/photo.png" }];
    const image = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#657183" } }).png().toBuffer();
    const bytes = zipSync({ "Document.textbundle/document.json": strToU8(JSON.stringify(document)), "Document.textbundle/text.md": strToU8('---\ntitle: "New title"\n---\n\nCurrent writing in the file.'), "Document.textbundle/assets/photo.png": image });
    const preview = await previewTextpack(bytes);
    expect(preview.title).toBe("New title");
    expect(preview.excerpt).toBe("Current writing in the file.");
    expect(preview.image?.contentType).toBe("image/jpeg");
    const metadata = await sharp(Buffer.from(preview.image!.data, "base64")).metadata();
    expect(metadata.width).toBe(480); expect(metadata.height).toBe(320);
  });
  it("does not fetch remote images and keeps text when image bytes are invalid", async () => {
    const document = emptyDocumentSnapshot();
    document.content.title = "Readable";
    document.content.fields.sourceUrl = "https://example.com/read";
    for (const src of ["https://example.com/image.png", "assets/invalid.png", "assets/../outside.png"]) {
      document.content.assets = [{ id: "photo", kind: "image", src }];
      const preview = await previewTextpack(zipSync({ "document.json": strToU8(JSON.stringify(document)), "assets/invalid.png": strToU8("not an image") }));
      expect(preview).toEqual({ title: "Readable", excerpt: "", sourceURL: "https://example.com/read" });
    }
  });
});
