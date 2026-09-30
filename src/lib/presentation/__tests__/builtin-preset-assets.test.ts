import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { builtinBrowserDocument, embedBuiltinPresetAssets } from "../../../../scripts/builtin-preset-assets";

const root = process.cwd();
const gallery = readFileSync(join(root, "presets/builtin/gallery.textpack"));
const documentPath = "gallery.textbundle/document.json";
const assetPath = "gallery.textbundle/assets/cover-118.jpg";

describe("portable built-in assets", () => {
  it("keeps original bytes in the pack and resolves browser examples to public covers", () => {
    const files = unzipSync(gallery);
    expect(Buffer.from(files[assetPath])).toEqual(readFileSync(join(root, "public/covers/cover-118.jpg")));
    const document = JSON.parse(strFromU8(files[documentPath]));
    expect(document.content.assets[0].src).toBe("assets/cover-118.jpg");
    const browser = builtinBrowserDocument(gallery, document, root) as typeof document;
    expect(browser.content.assets[0].src).toBe("/covers/cover-118.jpg");
    expect(document.content.assets[0].src).toBe("assets/cover-118.jpg");
  });

  it("migrates deterministically and is byte-identical on subsequent runs", () => {
    const files = unzipSync(gallery);
    for (const path of Object.keys(files)) {
      if (path.includes("/assets/")) delete files[path];
      else if (/\.(md|json)$/.test(path)) files[path] = strToU8(strFromU8(files[path]).replaceAll("assets/cover-", "/covers/cover-"));
    }
    const original = zipSync(files);
    const migrated = embedBuiltinPresetAssets(original, root);
    expect(migrated).toEqual(embedBuiltinPresetAssets(original, root));
    expect(embedBuiltinPresetAssets(migrated, root)).toEqual(migrated);
    expect(() => builtinBrowserDocument(migrated, JSON.parse(strFromU8(unzipSync(migrated)[documentPath])), root)).not.toThrow();
  });

  it("rejects missing or changed embedded originals", () => {
    const files = unzipSync(gallery);
    delete files[assetPath];
    expect(() => builtinBrowserDocument(zipSync(files), {}, root)).toThrow("missing or changed");
    files[assetPath] = new Uint8Array([0]);
    expect(() => builtinBrowserDocument(zipSync(files), {}, root)).toThrow("missing or changed");
  });

  it("rejects a preset that still relies on a public cover", () => {
    const files = unzipSync(gallery);
    files[documentPath] = strToU8(strFromU8(files[documentPath]).replaceAll("assets/cover-", "/covers/cover-"));
    expect(() => builtinBrowserDocument(zipSync(files), {}, root)).toThrow("image must be embedded");
  });
});
