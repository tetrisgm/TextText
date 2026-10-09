import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { strFromU8, strToU8 } from "fflate";
import { validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { mergeMarkdownIntoDocument } from "@/lib/documents/sync";
import { parsePostMarkdownFile, type ParsedPostMarkdownFile } from "@/lib/markdown-files";
import { reconcileDocumentSnapshots } from "@/lib/vault/reconcile";

/**
 * Projection provenance for one TextPack.
 *
 * `document.json` and `text.md` are two representations of one document, and
 * either may be edited on its own: an app save rewrites both, an agent may
 * rewrite only the JSON, a CLI append rewrites only the Markdown. A pack by
 * itself does not say which representation moved last. This sidecar records
 * the last coherent state a writer produced for both: the validated schema-v1
 * document plus the SHA-256 of the exact `text.md` and `document.json` bytes
 * written with it. Readers compare the current entries with those digests to
 * learn which representation changed since that state and reconcile each
 * against the recorded document.
 *
 * It is recovery metadata, never a second authority: when it is absent,
 * invalid, for another item, or neither digest matches, callers fall back to
 * their existing base and keep the ambiguity rather than invent chronology.
 */

export const PROJECTION_BASELINE_ENTRY = "net.texttext.projection.json";
export const PROJECTION_BASELINE_VERSION = 1 as const;

export type ProjectionBaseline = {
  version: typeof PROJECTION_BASELINE_VERSION;
  itemId: string;
  markdownSha256: string;
  documentSha256: string;
  document: DocumentSnapshot;
};

export type ProjectionProvenance = {
  baseline: DocumentSnapshot;
  /** `text.md` bytes differ from the ones written with the baseline. */
  markdownChanged: boolean;
  /** `document.json` bytes differ from the ones written with the baseline. */
  documentChanged: boolean;
};

const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** Synchronous SHA-256 so browser, Node and native writers agree on digests.
 * `@noble/hashes` is pure JavaScript with one code path for every runtime;
 * WebCrypto digests are asynchronous and `node:crypto` is absent in the
 * browser bundle. */
export function sha256Hex(input: Uint8Array | string): string {
  return bytesToHex(sha256(typeof input === "string" ? strToU8(input) : input));
}

/** The authored body exactly as vault writers emit it: one separator line after
 * the frontmatter, then the body byte for byte. */
export function parseProjectionMarkdown(markdown: string): ParsedPostMarkdownFile {
  const text = markdown.replace(/^﻿/, "");
  const parsed = parsePostMarkdownFile(text);
  const body = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n(?:\r?\n)?([\s\S]*)$/)?.[1];
  if (body !== undefined) parsed.body = body;
  return parsed;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The document both entries express when `text.md` is a faithful projection of
 * `document.json`; null when they disagree, so an incoherent pair is never
 * stamped as a baseline. Coherence is computed, never asserted by the caller. */
export function coherentProjection(markdown: string, documentJSON: string): DocumentSnapshot | null {
  try {
    const document = validateDocumentSnapshot(JSON.parse(documentJSON));
    // A frontmatter line the shared parser refuses is not a projection of
    // anything: the pair is simply not coherent, never an error for a writer.
    const parsed = parseProjectionMarkdown(markdown);
    if (parsed.body !== document.content.body) return null;
    const overlay = mergeMarkdownIntoDocument(document, parsed);
    return canonical(overlay) === canonical(document) ? document : null;
  } catch { return null; }
}

/** Sidecar bytes for a coherent pair, or null when the pair is not coherent. */
export function stampProjectionBaseline(itemId: string, markdown: Uint8Array | string, documentJSON: Uint8Array | string): Uint8Array | null {
  if (!IDENTITY.test(itemId)) return null;
  const markdownText = typeof markdown === "string" ? markdown : strFromU8(markdown);
  const documentText = typeof documentJSON === "string" ? documentJSON : strFromU8(documentJSON);
  const document = coherentProjection(markdownText, documentText);
  if (!document) return null;
  const baseline: ProjectionBaseline = {
    version: PROJECTION_BASELINE_VERSION, itemId,
    markdownSha256: sha256Hex(markdown), documentSha256: sha256Hex(documentJSON), document,
  };
  return strToU8(`${JSON.stringify(baseline)}\n`);
}

/** Parse and validate a sidecar for one item. Null for anything that is not a
 * version-1 baseline of this item holding a valid schema-v1 document. */
export function parseProjectionBaseline(bytes: Uint8Array | string | undefined, itemId: string): ProjectionBaseline | null {
  if (!bytes) return null;
  try {
    const raw: unknown = JSON.parse(typeof bytes === "string" ? bytes : strFromU8(bytes));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (value.version !== PROJECTION_BASELINE_VERSION || value.itemId !== itemId) return null;
    if (typeof value.markdownSha256 !== "string" || !HEX64.test(value.markdownSha256)) return null;
    if (typeof value.documentSha256 !== "string" || !HEX64.test(value.documentSha256)) return null;
    return {
      version: PROJECTION_BASELINE_VERSION, itemId,
      markdownSha256: value.markdownSha256, documentSha256: value.documentSha256,
      document: validateDocumentSnapshot(value.document),
    };
  } catch { return null; }
}

/** Provenance of the current entries relative to the stamped baseline. Null
 * when the sidecar is missing or invalid. When neither entry still matches,
 * both flags are set: the baseline then only proves a common earlier state,
 * so callers may use it for a three-way merge but must keep their existing
 * base when that merge conflicts, rather than trust the stale stamp. */
export function readProjectionProvenance(input: {
  itemId: string; markdown: Uint8Array; documentJSON: Uint8Array; baseline: Uint8Array | undefined;
}): ProjectionProvenance | null {
  const baseline = parseProjectionBaseline(input.baseline, input.itemId);
  if (!baseline) return null;
  return {
    baseline: baseline.document,
    markdownChanged: sha256Hex(input.markdown) !== baseline.markdownSha256,
    documentChanged: sha256Hex(input.documentJSON) !== baseline.documentSha256,
  };
}

/** Item identity from `text.md` frontmatter, or null when a pack has none. */
export function projectionItemId(markdown: string): string | null {
  const header = markdown.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? "";
  const values = [...header.matchAll(/^textTextId:\s*(.*?)\s*$/gm)];
  if (values.length !== 1) return null;
  let value = values[0][1];
  try { if (value.startsWith('"')) value = JSON.parse(value); } catch { return null; }
  return typeof value === "string" && IDENTITY.test(value) ? value : null;
}

export type ProjectionResolution =
  /** The pack expresses one document, by coherence or by provenance. */
  | { status: "document"; document: DocumentSnapshot; provenance: ProjectionProvenance | null }
  /** The sidecar proves both entries moved since the last coherent state and
   * their edits compete. This is a real representation conflict; callers must
   * not resolve it against some other base. */
  | { status: "conflict" }
  /** No usable sidecar. The caller keeps its legacy behaviour. */
  | { status: "legacy" };

/** What one pack says about itself. A coherent pair is one document whatever
 * the sidecar says; otherwise the stamped baseline attributes the change: a
 * JSON-only change keeps its JSON, including deletions; a Markdown-only change
 * overlays the recorded document; when both moved they merge three-way against
 * it, and a failed merge is a proved conflict rather than a reason to fall
 * back, because the sidecar is exactly the common ancestor of both entries. */
export function resolveProjection(input: { markdown: Uint8Array | string; documentJSON: Uint8Array | string; baseline: Uint8Array | string | undefined | null }): ProjectionResolution {
  const markdownText = typeof input.markdown === "string" ? input.markdown : strFromU8(input.markdown);
  const documentText = typeof input.documentJSON === "string" ? input.documentJSON : strFromU8(input.documentJSON);
  const coherent = coherentProjection(markdownText, documentText);
  const itemId = projectionItemId(markdownText);
  const provenance = itemId ? readProjectionProvenance({
    itemId,
    markdown: typeof input.markdown === "string" ? strToU8(input.markdown) : input.markdown,
    documentJSON: typeof input.documentJSON === "string" ? strToU8(input.documentJSON) : input.documentJSON,
    baseline: input.baseline == null ? undefined : typeof input.baseline === "string" ? strToU8(input.baseline) : input.baseline,
  }) : null;
  if (coherent) return { status: "document", document: coherent, provenance };
  if (!provenance) return { status: "legacy" };
  let document: DocumentSnapshot;
  try { document = validateDocumentSnapshot(JSON.parse(documentText)); } catch { return { status: "legacy" }; }
  if (!provenance.markdownChanged) return { status: "document", document, provenance };
  let fromMarkdown: DocumentSnapshot;
  try { fromMarkdown = mergeMarkdownIntoDocument(provenance.baseline, parseProjectionMarkdown(markdownText)); } catch { return { status: "legacy" }; }
  if (!provenance.documentChanged) return { status: "document", document: fromMarkdown, provenance };
  const merged = reconcileDocumentSnapshots(provenance.baseline, document, fromMarkdown);
  return merged.status === "merged" ? { status: "document", document: merged.document, provenance } : { status: "conflict" };
}
