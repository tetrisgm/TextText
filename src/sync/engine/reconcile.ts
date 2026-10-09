import { diffChars } from "diff";
import {
  validateDocumentSnapshot,
  type DocumentSnapshot,
} from "@/lib/documents/model";

export type DocumentReconciliation =
  | { status: "merged"; document: DocumentSnapshot }
  | {
      status: "conflict";
      /** JSON pointers identifying conflicting values. */
      paths: string[];
      base: DocumentSnapshot;
      local: DocumentSnapshot;
      remote: DocumentSnapshot;
    };

const absent = Symbol("absent");
type Value = unknown;

function object(value: Value): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function equal(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  }
  if (object(a) && object(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(
      (key) => Object.hasOwn(b, key) && equal(a[key], b[key]),
    );
  }
  return false;
}

interface TextEdit { start: number; end: number; replacement: string }

/** Map an accepted external body edit through the local edit. Unlike diffing
 * the merged text, this preserves authorship of equal boundary characters
 * (for example the space at the beginning of a person's pending append). */
export function externalBodyEdit(base: string, local: string, external: string): TextEdit | null {
  if (external === base || external === local) return null;
  const incoming = edit(base, external);
  if (local === base) return incoming;
  const own = edit(base, local);
  if (own.end <= incoming.start && own.start < incoming.start) {
    const shift = own.replacement.length - (own.end - own.start);
    return { ...incoming, start: incoming.start + shift, end: incoming.end + shift };
  }
  return incoming;
}

/** External authored ranges in descending local coordinates. Never diff the
 * merged result: doing so can remove/reinsert a person's equal boundary text,
 * destroying its Yjs identity and undo ownership. Verify the full projection
 * before the caller changes any shared text. */
export function externalBodyEdits(base: string, local: string, external: string, merged: string): TextEdit[] | undefined {
  const project = (edits: TextEdit[]) => edits.reduce((text, change) =>
    text.slice(0, change.start) + change.replacement + text.slice(change.end), local);
  const single = externalBodyEdit(base, local, external);
  const fast = single ? [single] : [];
  if (project(fast) === merged) return fast;
  const ownSpan = edit(base, local), incomingSpan = edit(base, external);
  const start = Math.min(ownSpan.start, incomingSpan.start);
  const end = Math.max(ownSpan.end, incomingSpan.end), tail = base.length - end;
  const before = base.slice(start, end);
  const left = local.slice(start, local.length - tail), right = external.slice(start, external.length - tail);
  if (Math.max(before.length, left.length, right.length) > FALLBACK_SPAN_LIMIT) return undefined;
  const own = fallbackEdits(before, left, 1), incoming = fallbackEdits(before, right, 0);
  if (!own || !incoming) return undefined;
  const mapped: TextEdit[] = [];
  for (const change of incoming) {
    if (own.some(other => other.start === change.start && other.end === change.end && other.replacement === change.replacement)) continue;
    let shift = start;
    for (const other of own) {
      if (other.end <= change.start && other.start < change.start) {
        shift += other.replacement.length - (other.end - other.start);
      }
    }
    mapped.push({ start: change.start + shift, end: change.end + shift, replacement: change.replacement });
  }
  mapped.sort((a, b) => b.start - a.start);
  return project(mapped) === merged ? mapped : undefined;
}

/** Linear scan and constant auxiliary memory, including for very large notes.
 * Multiple edits on one side become a single conservative replacement span. */
function edit(base: string, changed: string): TextEdit {
  let start = 0;
  while (start < base.length && start < changed.length && base[start] === changed[start]) start++;
  // Do not split an emoji's UTF-16 surrogate pair.
  if (start > 0 && /[\uD800-\uDBFF]/.test(base[start - 1])) start--;
  let end = base.length;
  let changedEnd = changed.length;
  while (end > start && changedEnd > start && base[end - 1] === changed[changedEnd - 1]) {
    end--;
    changedEnd--;
  }
  if (end < base.length && /[\uDC00-\uDFFF]/.test(base[end])) {
    end++;
    changedEnd++;
  }
  return { start, end, replacement: changed.slice(start, changedEnd) };
}

function mergeBody(base: string, local: string, remote: string, concurrentInsertions?: "remote-first"): string | undefined {
  const localEdit = edit(base, local), remoteEdit = edit(base, remote);
  if (concurrentInsertions && localEdit.start === localEdit.end && remoteEdit.start === remoteEdit.end && localEdit.start === remoteEdit.start) {
    return base.slice(0, localEdit.start) + remoteEdit.replacement + localEdit.replacement + base.slice(localEdit.end);
  }
  const edits = [localEdit, remoteEdit].sort((a, b) => a.start - b.start);
  const [first, second] = edits;
  // Two insertions at the same position have no agreed ordering. Treat an
  // insertion at a replacement boundary conservatively for the same reason.
  if (first.end > second.start || (first.end === second.start &&
      (first.start === first.end || second.start === second.end))) {
    return concurrentInsertions ? mergeBodyFallback(base, local, remote, localEdit, remoteEdit) : undefined;
  }
  return base.slice(0, first.start) + first.replacement +
    base.slice(first.end, second.start) + second.replacement + base.slice(second.end);
}

/** Bounds for the diff-based fallback: the longest three-way span handed to
 * jsdiff and the deterministic Myers edit distance it may explore per side. */
const FALLBACK_SPAN_LIMIT = 20_000;
const FALLBACK_EDIT_LIMIT = 2_000;

/** 0 is remote, 1 is local, so a stable sort orders coincident insertions remote-first. */
interface SidedEdit extends TextEdit { side: 0 | 1 }

/** Split one side's change into separate edits with jsdiff, so several
 * disjoint insertions or replacements no longer collapse into one span.
 * Returns undefined when the edit distance exceeds the deterministic limit. */
function fallbackEdits(base: string, changed: string, side: 0 | 1): SidedEdit[] | undefined {
  const changes = diffChars(base, changed, { maxEditLength: FALLBACK_EDIT_LIMIT });
  if (!changes) return undefined;
  const edits: SidedEdit[] = [];
  let position = 0;
  let current: SidedEdit | undefined;
  for (const change of changes) {
    if (!change.added && !change.removed) {
      position += change.value.length;
      current = undefined;
      continue;
    }
    if (!current) {
      current = { start: position, end: position, replacement: "", side };
      edits.push(current);
    }
    if (change.removed) {
      current.end += change.value.length;
      position += change.value.length;
    } else {
      current.replacement += change.value;
    }
  }
  // Myers alignments are ambiguous inside repeated text. Slide each edit as far
  // right as it stays equivalent so both sides anchor identical changes alike.
  edits.forEach((edit, index) => slideRight(base, edit, edits[index + 1]?.start ?? base.length));
  return edits;
}

function slideRight(base: string, edit: SidedEdit, limit: number): void {
  while (edit.end < limit) {
    const step = /[\uD800-\uDBFF]/.test(base[edit.start]) ? 2 : 1;
    if (edit.end + step > limit) return;
    if (/[\uDC00-\uDFFF]/.test(base[edit.end + step] ?? "")) return;
    const leading = base.slice(edit.start, edit.start + step);
    if (edit.replacement) {
      if (edit.replacement.slice(0, step) !== leading) return;
      edit.replacement = edit.replacement.slice(step) + base.slice(edit.end, edit.end + step);
    } else if (base.slice(edit.end, edit.end + step) !== leading) {
      return;
    }
    edit.start += step;
    edit.end += step;
  }
}

/** Used only for remote-first callers when the linear single-span merge
 * refuses. Diffs the shared span covering both edits, interleaves disjoint
 * edits, dedupes identical ones, and keeps the fast path's conflict rules for
 * overlapping spans and insertions at the other side's replacement boundary. */
function mergeBodyFallback(
  base: string, local: string, remote: string, localEdit: TextEdit, remoteEdit: TextEdit,
): string | undefined {
  const start = Math.min(localEdit.start, remoteEdit.start);
  const end = Math.max(localEdit.end, remoteEdit.end);
  const tail = base.length - end;
  const baseMid = base.slice(start, end);
  const localMid = local.slice(start, local.length - tail);
  const remoteMid = remote.slice(start, remote.length - tail);
  if (Math.max(baseMid.length, localMid.length, remoteMid.length) > FALLBACK_SPAN_LIMIT) return undefined;
  const remoteEdits = fallbackEdits(baseMid, remoteMid, 0);
  if (!remoteEdits) return undefined;
  const localEdits = fallbackEdits(baseMid, localMid, 1);
  if (!localEdits) return undefined;
  const edits = [...remoteEdits, ...localEdits].sort((a, b) => a.start - b.start || a.side - b.side);
  let merged = "";
  let cursor = 0;
  let previous: SidedEdit | undefined;
  for (const current of edits) {
    if (previous) {
      if (previous.start === current.start && previous.end === current.end &&
          previous.replacement === current.replacement) continue;
      if (previous.end > current.start) return undefined;
      if (previous.end === current.start && previous.side !== current.side &&
          (previous.start === previous.end) !== (current.start === current.end)) return undefined;
    }
    merged += baseMid.slice(cursor, current.start) + current.replacement;
    cursor = current.end;
    previous = current;
  }
  return base.slice(0, start) + merged + baseMid.slice(cursor) + base.slice(end);
}

/** Reconcile replicas against their last shared snapshot. No I/O or side effects.
 * A conflict returns all three snapshots and no writable document: callers must
 * preserve the divergent copies before asking a person to resolve the conflict.
 * Arrays and template references are atomic; independent object keys can merge.
 */
export function reconcileDocumentSnapshots(
  baseInput: DocumentSnapshot,
  localInput: DocumentSnapshot,
  remoteInput: DocumentSnapshot,
  options?: { concurrentInsertions?: "remote-first" },
): DocumentReconciliation {
  const base = validateDocumentSnapshot(baseInput);
  const local = validateDocumentSnapshot(localInput);
  const remote = validateDocumentSnapshot(remoteInput);
  const paths: string[] = [];

  function merge(before: Value, left: Value, right: Value, path: string): Value {
    if (equal(left, right)) return left;
    if (equal(left, before)) return right;
    if (equal(right, before)) return left;
    if (path === "/content/body" && typeof before === "string" &&
        typeof left === "string" && typeof right === "string") {
      const merged = mergeBody(before, left, right, options?.concurrentInsertions);
      if (merged !== undefined) return merged;
    } else if (path !== "/presentation/template" && object(before) && object(left) && object(right)) {
      const keys = new Set([...Object.keys(before), ...Object.keys(left), ...Object.keys(right)]);
      const entries: [string, Value][] = [];
      for (const key of keys) {
        const value = merge(
          Object.hasOwn(before, key) ? before[key] : absent,
          Object.hasOwn(left, key) ? left[key] : absent,
          Object.hasOwn(right, key) ? right[key] : absent,
          `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`,
        );
        if (value !== absent) entries.push([key, value]);
      }
      return Object.fromEntries(entries);
    }
    paths.push(path);
    return left;
  }

  const document = merge(base, local, remote, "");
  if (paths.length) return { status: "conflict", paths, base, local, remote };
  // A merge can exceed schema limits even when both inputs were individually valid.
  try {
    return { status: "merged", document: validateDocumentSnapshot(document) };
  } catch {
    return { status: "conflict", paths: [""], base, local, remote };
  }
}
