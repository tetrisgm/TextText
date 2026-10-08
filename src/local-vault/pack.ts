import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import type { VaultFile } from "./bridge";

export type OpenPack = { entries: Record<string, Uint8Array>; prefix: string; file: VaultFile; itemId: string };
export type PackAssetAddition = { filename: string; data: Uint8Array; contentType?: string; remoteURL?: string };
const MAX_BYTES = 64 * 1024 * 1024;
const fixedDate = new Date(1980, 0, 1);
function base64(bytes: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
export function packIdentity(markdown: string): string {
  const header = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? "";
  const values = [...header.matchAll(/^textTextId:\s*(.*?)\s*$/gm)];
  if (values.length !== 1) throw new Error("The TextPack must have exactly one textTextId.");
  let value = values[0][1];
  if (value.startsWith('"')) value = JSON.parse(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw new Error("The TextPack identity is invalid.");
  return value;
}
export function replacePackIdentity(markdown: string, id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new Error("The TextPack identity is invalid.");
  const header = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!header) return `---\ntextTextId: ${JSON.stringify(id)}\n---\n\n${markdown}`;
  const lines = header[1].split(/\r?\n/).filter((line) => !/^textTextId:/.test(line));
  return `---\ntextTextId: ${JSON.stringify(id)}\n${lines.join("\n")}\n---\n${markdown.slice(header[0].length)}`;
}
export function openPack(bytes: Uint8Array, path: string, hash: string, expectedId?: string): OpenPack {
  if (bytes.length > MAX_BYTES) throw new Error("This TextPack exceeds the browser's 64 MiB limit.");
  let size = 0, count = 0;
  const entries = unzipSync(bytes, { filter(entry) {
    if (++count > 10000 || (size += entry.originalSize) > MAX_BYTES) throw new Error("Expanded TextPack exceeds the browser's 64 MiB limit.");
    if (entry.name.startsWith("/") || entry.name.includes("\\") || entry.name.split("/").some((part) => part === "..")) throw new Error("Invalid TextPack entry path.");
    return true;
  } });
  const documents = Object.keys(entries).filter((name) => name === "document.json" || name.endsWith("/document.json"));
  if (documents.length !== 1) throw new Error("A TextPack must contain one document.json.");
  const prefix = documents[0].slice(0, -"document.json".length);
  const text = (name: string) => entries[prefix + name] ? strFromU8(entries[prefix + name]) : null;
  const markdown = text("text.md");
  if (markdown === null) throw new Error("This TextPack is missing text.md.");
  const itemId = packIdentity(markdown);
  if (expectedId && itemId !== expectedId) throw new Error("The TextPack identity does not match its server file.");
  const info = text("info.json");
  const mappings = info ? (JSON.parse(info)["net.texttext.assets"] ?? {}) : {};
  const assets = Object.entries(entries).filter(([name]) => name.startsWith(prefix + "assets/") && !name.endsWith("/")).map(([name, data]) => {
    const filename = name.slice((prefix + "assets/").length);
    const mapping = mappings[filename] ?? {};
    const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", mp4: "video/mp4", mp3: "audio/mpeg", pdf: "application/pdf" };
    return { filename, data: base64(data), contentType: mapping.contentType || types[filename.split(".").at(-1)?.toLowerCase() ?? ""] || "application/octet-stream", ...(typeof mapping.url === "string" ? { remoteURL: mapping.url } : {}) };
  });
  return { entries, prefix, itemId, file: { path, hash, markdown, documentJSON: text("document.json"), templateJSON: text("template.json"), templateAuthoringSourceJSON: text("template-source.json"), assets } };
}
export function encodePack(pack: Pick<OpenPack, "entries" | "prefix">, changes: Pick<VaultFile, "markdown" | "documentJSON" | "templateJSON" | "templateAuthoringSourceJSON">, addedAssets: readonly PackAssetAddition[] = []): Uint8Array {
  const entries = { ...pack.entries };
  const originalMarkdown = entries[pack.prefix + "text.md"];
  if (originalMarkdown && packIdentity(strFromU8(originalMarkdown)) !== packIdentity(changes.markdown)) {
    // Receipts fence mutations of one item. A fresh identity must start without
    // the source item's receipts; ordinary writes retain them unchanged.
    for (const name of Object.keys(entries)) {
      if (name.startsWith(pack.prefix + "net.texttext.mutations/")) delete entries[name];
    }
  }
  entries[pack.prefix + "text.md"] = strToU8(changes.markdown);
  for (const [name, value] of [["document.json", changes.documentJSON], ["template.json", changes.templateJSON], ["template-source.json", changes.templateAuthoringSourceJSON]] as const) {
    if (value !== undefined && value !== null) entries[pack.prefix + name] = strToU8(value);
    else if (name !== "document.json") delete entries[pack.prefix + name];
  }
  if (!entries[pack.prefix + "document.json"]) throw new Error("A TextPack requires document.json.");
  const occupied = new Map(Object.keys(entries).map((name) => [name.normalize("NFC").toLocaleLowerCase(), name]));
  const infoPath = pack.prefix + "info.json";
  const info = entries[infoPath] ? JSON.parse(strFromU8(entries[infoPath])) as Record<string, unknown>
    : { version: 2, type: "net.daringfireball.markdown", transient: false, creatorIdentifier: "app.texttext" };
  const priorMappings = info["net.texttext.assets"];
  const mappings = priorMappings && typeof priorMappings === "object" && !Array.isArray(priorMappings)
    ? { ...priorMappings as Record<string, unknown> } : {};
  let mappingsChanged = false;
  for (const asset of addedAssets) {
    if (!asset.filename || asset.filename.startsWith(".") || asset.filename.length > 255 || /[\\/\x00-\x1f]/.test(asset.filename)) {
      throw new Error("Invalid TextPack asset filename.");
    }
    if (asset.contentType !== undefined && !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(asset.contentType)) throw new Error("Invalid TextPack asset content type.");
    if (asset.remoteURL !== undefined) {
      const remote = new URL(asset.remoteURL);
      if (!["http:", "https:"].includes(remote.protocol) || remote.username || remote.password || remote.href.length > 4096) throw new Error("Invalid TextPack asset source URL.");
    }
    const key = `${pack.prefix}assets/${asset.filename}`;
    const normalized = key.normalize("NFC").toLocaleLowerCase();
    const existingKey = occupied.get(normalized);
    if (existingKey) {
      const existing = entries[existingKey];
      if (existing.byteLength !== asset.data.byteLength || existing.some((value, index) => value !== asset.data[index])) {
        throw new Error("A TextPack asset already uses that filename.");
      }
    } else {
      occupied.set(normalized, key);
      entries[key] = new Uint8Array(asset.data);
    }
    const filename = (existingKey ?? key).slice((pack.prefix + "assets/").length);
    const prior = mappings[filename];
    const mapping = prior && typeof prior === "object" && !Array.isArray(prior)
      ? { ...prior as Record<string, unknown> } : {};
    mapping.url = asset.remoteURL ?? (typeof mapping.url === "string" ? mapping.url : `assets/${filename}`);
    if (asset.contentType) mapping.contentType = asset.contentType;
    mappings[filename] = mapping;
    mappingsChanged = true;
  }
  if (mappingsChanged) entries[infoPath] = strToU8(JSON.stringify({ ...info, "net.texttext.assets": mappings }));
  if (Object.keys(entries).length > 10_000 || Object.values(entries).reduce((sum, data) => sum + data.byteLength, 0) > MAX_BYTES) {
    throw new Error("Expanded TextPack exceeds the browser's 64 MiB limit.");
  }
  return zipSync(Object.fromEntries(Object.keys(entries).sort().map((key) => [key, [entries[key], { level: 0, mtime: fixedDate }]])), { level: 0, mtime: fixedDate });
}
export function emptyPack(): Pick<OpenPack, "entries" | "prefix"> {
  return { prefix: "Document.textbundle/", entries: { "Document.textbundle/info.json": strToU8(JSON.stringify({ version: 2, type: "net.daringfireball.markdown", transient: false, creatorIdentifier: "app.texttext", "net.texttext.assets": {} })) } };
}
