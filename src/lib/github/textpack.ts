import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * A `.textpack` as the Mac app writes it: a zip holding one `.textbundle`
 * directory with `text.md`, `document.json`, an optional `template.json`,
 * and `info.json`. Bytes are deterministic (fixed timestamps, stored
 * entries) so the same document always yields the same git blob, and an
 * unchanged item costs the backup nothing.
 */

export type TextpackParts = { markdown: string; document: unknown; template?: unknown; sourceUrl?: string | null };

// ZIP records local calendar fields. UTC midnight becomes 1979 west of UTC,
// which is outside ZIP's range; local midnight also gives every zone the same bytes.
const EPOCH = new Date(1980, 0, 1);

export function buildTextpack(name: string, parts: TextpackParts): Uint8Array {
  const folder = `${name}.textbundle`;
  const info = {
    version: 2,
    type: "net.daringfireball.markdown",
    transient: false,
    creatorIdentifier: "app.texttext",
    ...(parts.sourceUrl ? { sourceURL: parts.sourceUrl } : {}),
    "net.texttext.assets": {},
  };
  const entries: Record<string, [Uint8Array, { level: 0; mtime: Date }]> = {
    [`${folder}/text.md`]: [strToU8(parts.markdown), { level: 0, mtime: EPOCH }],
    [`${folder}/document.json`]: [strToU8(`${JSON.stringify(parts.document, null, 2)}\n`), { level: 0, mtime: EPOCH }],
    [`${folder}/info.json`]: [strToU8(`${JSON.stringify(info, null, 2)}\n`), { level: 0, mtime: EPOCH }],
  };
  if (parts.template) entries[`${folder}/template.json`] = [strToU8(`${JSON.stringify(parts.template, null, 2)}\n`), { level: 0, mtime: EPOCH }];
  return zipSync(entries, { mtime: EPOCH });
}

export function parseTextpack(bytes: Uint8Array): TextpackParts {
  const files = unzipSync(bytes);
  const find = (leaf: string) => {
    const key = Object.keys(files).find((path) => path.endsWith(`/${leaf}`) || path === leaf);
    return key ? strFromU8(files[key]) : null;
  };
  const markdown = find("text.md");
  const document = find("document.json");
  if (markdown === null || document === null) throw new Error("Not a TextText textpack: text.md or document.json is missing");
  const template = find("template.json");
  const info = find("info.json");
  let sourceUrl: string | null = null;
  if (info) {
    try {
      const parsed = JSON.parse(info) as { sourceURL?: unknown };
      if (typeof parsed.sourceURL === "string") sourceUrl = parsed.sourceURL;
    } catch {
      // info.json is advisory.
    }
  }
  return { markdown, document: JSON.parse(document), template: template ? JSON.parse(template) : undefined, sourceUrl };
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
