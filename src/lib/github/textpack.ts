import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PROJECTION_BASELINE_ENTRY, projectionItemId, stampProjectionBaseline } from "@/lib/documents/projection-baseline";

/**
 * A `.textpack` as the Mac app writes it: a zip holding one `.textbundle`
 * directory with `text.md`, `document.json`, optional `template.json` and
 * `template-source.json`, and `info.json`. Bytes are deterministic (fixed timestamps, stored
 * entries) so the same document always yields the same git blob, and an
 * unchanged item costs the backup nothing.
 */

export type TextpackParts = {
  markdown: string;
  document: unknown;
  template?: unknown;
  templateAuthoringSource?: unknown;
  sourceUrl?: string | null;
  /** Uninterpreted files relative to the bundle root; preserved across edits. */
  files?: Record<string, Uint8Array>;
  info?: Record<string, unknown>;
};

// ZIP records local calendar fields. UTC midnight becomes 1979 west of UTC,
// which is outside ZIP's range; local midnight also gives every zone the same bytes.
const EPOCH = new Date(1980, 0, 1);

const MAX_BYTES = 64 * 1024 * 1024;
function safePath(path: string): boolean {
  return !!path && !path.includes("\\") && !Array.from(path).some((char) => char.charCodeAt(0) < 32)
    && !path.split("/").some((part) => !part || part === "." || part === "..")
    && !/^[A-Za-z]:/.test(path);
}

export function buildTextpack(name: string, parts: TextpackParts): Uint8Array {
  if (!safePath(name) || name.includes("/")) throw new Error("Invalid TextPack name");
  const folder = `${name}.textbundle`;
  const info = {
    version: 2,
    type: "net.daringfireball.markdown",
    transient: false,
    creatorIdentifier: "app.texttext",
    "net.texttext.assets": {},
    ...parts.info,
    ...(parts.sourceUrl ? { sourceURL: parts.sourceUrl } : {}),
  };
  if (parts.sourceUrl === null) delete (info as Record<string, unknown>).sourceURL;
  const entries: Record<string, [Uint8Array, { level: 0; mtime: Date }]> = {
    [`${folder}/text.md`]: [strToU8(parts.markdown), { level: 0, mtime: EPOCH }],
    [`${folder}/document.json`]: [strToU8(`${JSON.stringify(parts.document, null, 2)}\n`), { level: 0, mtime: EPOCH }],
    [`${folder}/info.json`]: [strToU8(`${JSON.stringify(info, null, 2)}\n`), { level: 0, mtime: EPOCH }],
  };
  if (parts.template) {
    entries[`${folder}/template.json`] = [strToU8(`${JSON.stringify(parts.template, null, 2)}\n`), { level: 0, mtime: EPOCH }];
    if (parts.templateAuthoringSource) {
      entries[`${folder}/template-source.json`] = [strToU8(`${JSON.stringify(parts.templateAuthoringSource, null, 2)}\n`), { level: 0, mtime: EPOCH }];
    }
  }
  // Stamp projection provenance for a coherent pair; a diverged pair keeps any
  // sidecar carried in `files`, whose digests still attribute the change.
  const itemId = projectionItemId(parts.markdown);
  const stamp = itemId ? stampProjectionBaseline(itemId, entries[`${folder}/text.md`][0], entries[`${folder}/document.json`][0]) : null;
  if (stamp) entries[`${folder}/${PROJECTION_BASELINE_ENTRY}`] = [stamp, { level: 0, mtime: EPOCH }];
  for (const path of Object.keys(parts.files ?? {}).sort()) {
    if (!safePath(path)) throw new Error("Invalid TextPack entry path");
    const key = `${folder}/${path}`;
    if (!(key in entries)) entries[key] = [parts.files![path], { level: 0, mtime: EPOCH }];
  }
  if (Object.keys(entries).length > 10000 || Object.values(entries).reduce((sum, [data]) => sum + data.byteLength, 0) > MAX_BYTES) {
    throw new Error("Expanded TextPack exceeds 64 MiB limit");
  }
  return zipSync(entries, { mtime: EPOCH });
}

export function parseTextpack(bytes: Uint8Array): TextpackParts {
  if (bytes.byteLength > MAX_BYTES) throw new Error("TextPack exceeds 64 MiB limit");
  let size = 0;
  const seen = new Set<string>();
  const files = unzipSync(bytes, { filter(entry) {
    const path = entry.name.endsWith("/") ? entry.name.slice(0, -1) : entry.name;
    if (!safePath(path) || seen.has(entry.name)) throw new Error("Invalid or duplicate TextPack entry");
    seen.add(entry.name);
    if (seen.size > 10000 || (size += entry.originalSize) > MAX_BYTES) throw new Error("Expanded TextPack exceeds 64 MiB limit");
    return !entry.name.endsWith("/");
  } });
  const roots = Object.keys(files).filter((path) => path === "text.md" || path.endsWith("/text.md"));
  if (roots.length !== 1) throw new Error("TextPack must contain one document root");
  const root = roots[0].slice(0, -"text.md".length);
  if (Object.keys(files).some((path) => !path.startsWith(root))) throw new Error("TextPack contains files outside its document root");
  const find = (leaf: string) => files[root + leaf] ? strFromU8(files[root + leaf]) : null;
  const markdown = find("text.md");
  const document = find("document.json");
  if (markdown === null || document === null) throw new Error("Not a TextText textpack: text.md or document.json is missing");
  const template = find("template.json");
  const templateAuthoringSource = template ? find("template-source.json") : null;
  const optionalJSON = (value: string | null): unknown => {
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  };
  const info = find("info.json");
  let sourceUrl: string | null = null;
  let metadata: Record<string, unknown> | undefined;
  if (info) {
    try {
      const parsed = JSON.parse(info);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid info");
      metadata = parsed;
      if (typeof parsed.sourceURL === "string") sourceUrl = parsed.sourceURL;
    } catch {
      // info.json is advisory.
    }
  }
  return {
    markdown,
    document: JSON.parse(document),
    template: optionalJSON(template),
    templateAuthoringSource: optionalJSON(templateAuthoringSource),
    sourceUrl,
    info: metadata,
    files: Object.fromEntries(Object.entries(files)
      .filter(([path]) => !["text.md", "document.json", "info.json"].includes(path.slice(root.length)))
      .map(([path, data]) => [path.slice(root.length), data])),
  };
}

/** What git would call this content: sha1 over "blob <size>\0<bytes>". */
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A file name safe for git and for a Mac, from a slug. */
export function textpackFileName(slug: string): string {
  const safe = slug.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "") || "item";
  return `${safe}.textpack`;
}
