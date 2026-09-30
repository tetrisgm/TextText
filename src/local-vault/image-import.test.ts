import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { encodeImagePack } from "./image-import";
import { openPack } from "./pack";
import { readDocument } from "./model";

describe("image TextPacks", () => {
  it("preserves original GIF bytes, editable gallery content and unique identities", () => {
    const original = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), (character) => character.charCodeAt(0));
    const first = encodeImagePack(original, "Tiny.gif");
    const second = encodeImagePack(original, "Tiny.gif");
    const file = openPack(first.bytes, "Visuals/Tiny.textpack", "");
    const entries = unzipSync(first.bytes);
    expect(entries[file.prefix + "assets/original.gif"]).toEqual(original);
    expect(file.itemId).not.toBe(openPack(second.bytes, "Other.textpack", "").itemId);
    const document = readDocument(file.file);
    expect(document.content.title).toBe("Tiny");
    expect(document.content.assets[0]).toMatchObject({ src: "assets/original.gif", kind: "image", contentType: "image/gif" });
    expect(JSON.parse(file.file.templateJSON!).id).toBe("texttext.gallery");
  });
  it("rejects unsupported bytes and oversized images before packing", () => {
    expect(() => encodeImagePack(new TextEncoder().encode("<svg/>"), "fake.png")).toThrow("PNG");
    expect(() => encodeImagePack(new Uint8Array(20 * 1024 * 1024 + 1), "large.gif")).toThrow("20 MiB");
  });
});
