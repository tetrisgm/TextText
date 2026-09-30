import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const coverReference = /\/covers\/(cover-\d{3}\.jpg)/g;
const localReference = /assets\/(cover-\d{3}\.jpg)/g;
const epoch = new Date(1980, 0, 1);

/** Built-in packs own their original image bytes. Browser examples still use
 * the same public images because they render outside a TextPack resolver. */
export function embedBuiltinPresetAssets(bytes: Uint8Array, root: string): Uint8Array {
  const files = unzipSync(bytes);
  const documentPath = Object.keys(files).find((path) => path.endsWith("/document.json"));
  if (!documentPath) throw new Error("Built-in pack is missing document.json");
  const folder = documentPath.slice(0, -"document.json".length);
  let changed = false;
  for (const name of ["text.md", "document.json"]) {
    const path = folder + name;
    const original = strFromU8(files[path]);
    const localized = original.replace(coverReference, (_reference, filename: string) => {
      const assetPath = `${folder}assets/${filename}`;
      const image = readFileSync(join(root, "public", "covers", filename));
      if (files[assetPath] && !image.equals(files[assetPath])) {
        throw new Error(`Refusing to replace different embedded image: ${filename}`);
      }
      files[assetPath] = image;
      return `assets/${filename}`;
    });
    if (localized !== original) { files[path] = strToU8(localized); changed = true; }
  }
  if (!changed) return bytes;
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, data]) =>
    [path, [data, { level: 0, mtime: epoch }]],
  )), { mtime: epoch });
}

export function builtinBrowserDocument(bytes: Uint8Array, document: unknown, root: string): unknown {
  const files = unzipSync(bytes);
  const documentPath = Object.keys(files).find((path) => path.endsWith("/document.json"));
  if (!documentPath) throw new Error("Built-in pack is missing document.json");
  const folder = documentPath.slice(0, -"document.json".length);
  for (const [path, data] of Object.entries(files)) {
    if (!/\.(json|md)$/.test(path)) continue;
    const text = strFromU8(data);
    if (text.match(coverReference)) throw new Error(`${path}: image must be embedded in this TextPack`);
    for (const match of text.matchAll(localReference)) {
      const filename = match[1];
      const embedded = files[`${folder}assets/${filename}`];
      if (!embedded || !readFileSync(join(root, "public", "covers", filename)).equals(embedded)) {
        throw new Error(`${path}: missing or changed original embedded image ${filename}`);
      }
    }
  }
  return JSON.parse(JSON.stringify(document).replace(localReference, "/covers/$1"));
}
