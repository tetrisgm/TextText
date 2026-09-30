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

function mergeBody(base: string, local: string, remote: string): string | undefined {
  const edits = [edit(base, local), edit(base, remote)].sort((a, b) => a.start - b.start);
  const [first, second] = edits;
  // Two insertions at the same position have no agreed ordering. Treat an
  // insertion at a replacement boundary conservatively for the same reason.
  if (first.end > second.start || (first.end === second.start &&
      (first.start === first.end || second.start === second.end))) return undefined;
  return base.slice(0, first.start) + first.replacement +
    base.slice(first.end, second.start) + second.replacement + base.slice(second.end);
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
      const merged = mergeBody(before, left, right);
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
