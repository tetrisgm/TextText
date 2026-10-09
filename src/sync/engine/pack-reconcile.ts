import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { mergeMarkdownIntoDocument } from "@/lib/documents/sync";
import { legacyProjectionFromDocument } from "@/lib/documents/legacy";
import { parsePostMarkdownFile } from "@/lib/markdown-files";
import { reconcileDocumentSnapshots } from "./reconcile";

type Entries = Record<string, Uint8Array>;
type Result = { status: "merged"; bytes: Uint8Array } | { status: "conflict"; paths: string[] };
function equal(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  return a === b || (!!a && !!b && a.length === b.length && a.every((byte, index) => byte === b[index]));
}

function unpack(bytes: Uint8Array) {
  let size = 0;
  let count = 0;
  const raw = unzipSync(bytes, { filter(entry) {
    if (++count > 10000 || (size += entry.originalSize) > 64 * 1024 * 1024) throw new Error("Pack merge limit");
    if (entry.name.startsWith("/") || entry.name.includes("\\") || entry.name.split("/").includes("..")) throw new Error("Unsafe pack path");
    return true;
  } });
  const documents = Object.keys(raw).filter((name) => name === "document.json" || name.endsWith("/document.json"));
  if (documents.length !== 1) throw new Error("Ambiguous document");
  const prefix = documents[0].slice(0, -"document.json".length);
  const files: Entries = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!name.startsWith(prefix)) throw new Error("Files outside TextPack document");
    if (!name.endsWith("/")) files[name.slice(prefix.length)] = value;
  }
  if (!files["text.md"]) throw new Error("Missing Markdown");
  return { prefix, files, document: validateDocumentSnapshot(JSON.parse(strFromU8(files["document.json"]))) };
}

function effective(base: ReturnType<typeof unpack>, branch: ReturnType<typeof unpack>): DocumentSnapshot | null {
  if (equal(base.files["text.md"], branch.files["text.md"])) return branch.document;
  const fromMarkdown = mergeMarkdownIntoDocument(base.document, parsePostMarkdownFile(strFromU8(branch.files["text.md"])));
  const merged = reconcileDocumentSnapshots(base.document, branch.document, fromMarkdown);
  return merged.status === "merged" ? merged.document : null;
}

function frontmatter(bytes: Uint8Array): Record<string, string> {
  const text = strFromU8(bytes).replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const field = /^([A-Za-z][A-Za-z0-9_-]*):\s?(.*)$/.exec(line);
    if (!field || Object.hasOwn(result, field[1])) throw new Error("Unsupported frontmatter");
    Object.defineProperty(result, field[1], { value: field[2], writable: true, enumerable: true });
  }
  return result;
}

/** Full archive merge: document edits merge structurally; each asset or template
 * entry is atomic. Binary conflicts return no output archive. Each unpack is
 * capped at 64 MiB and text reconciliation uses linear scans, never an LCS table.
 */
export function reconcileTextpacks(baseBytes: Uint8Array, localBytes: Uint8Array, remoteBytes: Uint8Array): Result {
  try {
    const base = unpack(baseBytes);
    const local = unpack(localBytes);
    const remote = unpack(remoteBytes);
    const localDocument = effective(base, local);
    const remoteDocument = effective(base, remote);
    if (!localDocument || !remoteDocument) return { status: "conflict", paths: ["/document/markdown"] };
    const result = reconcileDocumentSnapshots(base.document, localDocument, remoteDocument, {
      concurrentInsertions: "remote-first",
    });
    if (result.status === "conflict") return { status: "conflict", paths: result.paths };
    const conflicts: string[] = [];
    const merged: Entries = {};
    for (const name of new Set([...Object.keys(base.files), ...Object.keys(local.files), ...Object.keys(remote.files)])) {
      if (name === "document.json" || name === "text.md") continue;
      const before = base.files[name], left = local.files[name], right = remote.files[name];
      const value = equal(left, right) ? left : equal(left, before) ? right : equal(right, before) ? left : null;
      if (value === null) conflicts.push(`/entries/${name}`);
      else if (value) merged[name] = value;
    }
    const metadata = [base, local, remote].map((pack) => frontmatter(pack.files["text.md"]));
    const fields: Record<string, string> = {};
    const projection = legacyProjectionFromDocument(result.document);
    // Document-projected fields are resolved above. Remaining frontmatter
    // (identity, status, custom metadata) merges independently without discarding it.
    for (const key of new Set(metadata.flatMap((value) => Object.keys(value)))) {
      if (Object.hasOwn(projection, key)) continue;
      const [before, left, right] = metadata.map((value) => value[key]);
      const value = left === right ? left : left === before ? right : right === before ? left : null;
      if (value === null) conflicts.push(`/frontmatter/${key}`);
      else if (value !== undefined) Object.defineProperty(fields, key, { value, enumerable: true, writable: true });
    }
    for (const [key, value] of Object.entries(projection)) {
      if (key === "body") continue;
      // Keep the same represented fields, plus title, so rich metadata remains
      // in document.json without inventing lossy frontmatter projections.
      if (key === "title" || metadata.some((entry) => Object.hasOwn(entry, key))) {
        if (value !== null && value !== undefined) fields[key] = JSON.stringify(value);
      }
    }
    if (conflicts.length) return { status: "conflict", paths: conflicts };
    merged["document.json"] = strToU8(JSON.stringify(result.document, null, 2) + "\n");
    merged["text.md"] = strToU8(`---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n\n${result.document.content.body}`);
    const output = Object.fromEntries(Object.entries(merged).map(([name, bytes]) => [remote.prefix + name, bytes]));
    return { status: "merged", bytes: zipSync(output, { level: 0, mtime: new Date(1980, 0, 1) }) };
  } catch {
    return { status: "conflict", paths: ["/pack"] };
  }
}
