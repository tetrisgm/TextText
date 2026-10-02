import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { previewTextpack } from "./pack-preview.server";

describe("TextPack folder previews", () => {
  it("uses current markdown and a bounded still from embedded image bytes", async () => {
    const document = emptyDocumentSnapshot();
    document.content.title = "Old title"; document.content.body = "Old body";
    document.content.subtitle = "A line beneath the title";
    document.content.assets = [{ id: "photo", kind: "image", src: "assets/photo.png" }];
    const image = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#657183" } }).png().toBuffer();
    const bytes = zipSync({ "Document.textbundle/document.json": strToU8(JSON.stringify(document)), "Document.textbundle/text.md": strToU8('---\ntitle: "New title"\n---\n\nCurrent writing in the file.'), "Document.textbundle/assets/photo.png": image });
    const metadataOnly = await previewTextpack(bytes, true);
    expect(metadataOnly.image).toBeUndefined();
    expect(metadataOnly.document.content.title).toBe("New title");
    expect(metadataOnly.document.content.subtitle).toBe("A line beneath the title");
    const preview = await previewTextpack(bytes);
    expect(preview.document.content.title).toBe("New title");
    expect(preview.document.content.body).toBe("Current writing in the file.");
    expect(preview.document.content.subtitle).toBe("A line beneath the title");
    expect(preview.document.content.assets).toEqual([]);
    expect(preview.title).toBe("New title");
    expect(preview.excerpt).toBe("Current writing in the file.");
    expect(preview.image?.contentType).toBe("image/jpeg");
    const metadata = await sharp(Buffer.from(preview.image!.data, "base64")).metadata();
    expect(metadata.width).toBe(480); expect(metadata.height).toBe(320);
  });
  it("reports incomplete query bindings without invalidating unrelated title or scalar fields", async () => {
    const document = emptyDocumentSnapshot();
    document.content.title = "A  title";
    document.content.fields.annotations = [{ quote: "Saved highlight" }];
    document.content.fields.description = "x".repeat(2049);
    document.content.fields.category = "  Research  notes  ";
    const preview = await previewTextpack(zipSync({ "document.json": strToU8(JSON.stringify(document)) }), true);
    expect(preview.incompleteFields).toEqual(["content.fields.annotations", "content.fields.description"]);
    expect(preview.metadataTruncated).toBe(true);
    expect(preview.document.content.title).toBe("A  title");
    expect(preview.document.content.fields.category).toBe("  Research  notes  ");
  });
  it("marks a clipped title and falls back to a wildcard for excessive omitted fields", async () => {
    const document = emptyDocumentSnapshot();
    document.content.title = "t".repeat(241);
    let preview = await previewTextpack(zipSync({ "document.json": strToU8(JSON.stringify(document)) }), true);
    expect(preview.incompleteFields).toEqual(["title"]);
    document.content.fields = Object.fromEntries(Array.from({ length: 2200 }, (_, index) => [`field${index}`, []]));
    preview = await previewTextpack(zipSync({ "document.json": strToU8(JSON.stringify(document)) }), true);
    expect(preview.incompleteFields).toEqual(["*"]);
  });
  it("does not fetch remote images and keeps text when image bytes are invalid", async () => {
    const document = emptyDocumentSnapshot();
    document.content.title = "Readable";
    document.content.fields.sourceUrl = "https://example.com/read";
    for (const src of ["https://example.com/image.png", "assets/invalid.png", "assets/../outside.png"]) {
      document.content.assets = [{ id: "photo", kind: "image", src }];
      const preview = await previewTextpack(zipSync({ "document.json": strToU8(JSON.stringify(document)), "assets/invalid.png": strToU8("not an image") }));
      expect(preview).toMatchObject({ title: "Readable", excerpt: "", sourceURL: "https://example.com/read" });
    }
  });
});
