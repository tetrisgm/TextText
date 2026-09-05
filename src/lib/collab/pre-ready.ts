import type * as Y from "yjs";
import { documentAssets, documentFields, documentPresentation, documentTags, documentTheme } from "@/lib/collab/document";
import type { DocumentSnapshot } from "@/lib/documents/model";

type Hunk = { start: number; end: number; insert: string };

/** Myers diff over UTF-16 offsets, the coordinate system used by Y.Text.
 * Trim the common edges so a small edit in a large document stays cheap.
 * Bound divergent input; the caller keeps the ledger for explicit recovery
 * instead of guessing a destructive replacement or freezing the editor. */
function textHunks(before: string, after: string): Hunk[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let endBefore = before.length, endAfter = after.length;
  while (endBefore > prefix && endAfter > prefix && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--; endAfter--;
  }
  const a = before.slice(prefix, endBefore), b = after.slice(prefix, endAfter);
  if (!a.length || !b.length) {
    return a === b ? [] : [{ start: prefix, end: endBefore, insert: b }];
  }
  let frontier = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  let work = 0;
  for (let d = 0; d <= a.length + b.length; d++) {
    trace.push(frontier);
    const next = new Map<number, number>();
    for (let k = -d; k <= d; k += 2) {
      if (++work > 1_000_000) throw new Error("Pre-ready text merge needs recovery");
      const down = frontier.get(k + 1) ?? -1;
      const right = frontier.get(k - 1) ?? -1;
      let x = k === -d || (k !== d && right < down) ? down : right + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++; }
      next.set(k, x);
      if (x >= a.length && y >= b.length) {
        const steps: ("equal" | "insert" | "delete")[] = [];
        for (let depth = d; depth >= 0; depth--) {
          const v = trace[depth], diagonal = x - y;
          const prevK = diagonal === -depth || (diagonal !== depth &&
            (v.get(diagonal - 1) ?? -1) < (v.get(diagonal + 1) ?? -1))
            ? diagonal + 1 : diagonal - 1;
          const prevX = v.get(prevK) ?? 0, prevY = prevX - prevK;
          while (x > prevX && y > prevY) { steps.push("equal"); x--; y--; }
          if (depth) {
            if (x === prevX) { steps.push("insert"); y--; }
            else { steps.push("delete"); x--; }
          }
        }
        const hunks: Hunk[] = [];
        let ai = prefix, bi = prefix, active: Hunk | undefined;
        for (const step of steps.reverse()) {
          if (step === "equal") { active = undefined; ai++; bi++; continue; }
          if (!active) { active = { start: ai, end: ai, insert: "" }; hunks.push(active); }
          if (step === "delete") { ai++; active.end++; }
          else { active.insert += after[bi++]; }
        }
        return hunks;
      }
    }
    frontier = next;
  }
  throw new Error("Pre-ready text merge needs recovery");
}

/** Plan local operations on the caught-up text. Delete only surviving baseline
 * characters, never a peer's insertion. Overlapping replacements keep both
 * insertions (remote then local); identical hunks are already satisfied.
 * The returned operations use remote offsets and run right to left, preserving
 * every untouched remote CRDT identity for subsequent peer deletions. */
export function preReadyTextOperations(baseline: string, local: string, remote: string): Hunk[] {
  if (local === baseline || local === remote) return [];
  const localHunks = textHunks(baseline, local);
  const remoteHunks = textHunks(baseline, remote);
  const equal: { start: number; end: number; offset: number }[] = [];
  let cursor = 0, offset = 0;
  for (const h of remoteHunks) {
    equal.push({ start: cursor, end: h.start, offset });
    offset += h.insert.length - (h.end - h.start);
    cursor = h.end;
  }
  equal.push({ start: cursor, end: baseline.length, offset });
  const operations: Hunk[] = [];
  for (const h of localHunks) {
    if (remoteHunks.some((r) => r.start === h.start && r.end === h.end && r.insert === h.insert)) continue;
    for (const span of equal) {
      const start = Math.max(h.start, span.start), end = Math.min(h.end, span.end);
      if (start < end) operations.push({ start: start + span.offset, end: end + span.offset, insert: "" });
    }
    if (h.insert) {
      let at = h.start;
      for (const r of remoteHunks) {
        if (r.start > h.start) break;
        if (r.end >= h.start) { at = r.start + (at - h.start) + r.insert.length; break; }
        at += r.insert.length - (r.end - r.start);
      }
      operations.push({ start: at, end: at, insert: h.insert });
    }
  }
  return operations.sort((a, b) => b.start - a.start || b.end - a.end);
}

export function applyPreReadyTextOperations(target: Y.Text, operations: Hunk[], origin: unknown): void {
  target.doc?.transact(() => {
    for (const h of operations) {
      if (h.end > h.start) target.delete(h.start, h.end - h.start);
      if (h.insert) target.insert(h.start, h.insert);
    }
  }, origin);
}

/** Apply only changed metadata entries. Replacing an entire Y.Array would
 * manufacture new identities for unchanged peer tags/assets, making their
 * later deletions ineffective even though the visible overlay was correct. */
export function applyPreReadyMetadata(doc: Y.Doc, snapshot: DocumentSnapshot, origin: unknown): void {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const patchMap = (target: Y.Map<unknown>, values: Record<string, unknown>) => {
    for (const key of target.keys()) if (!Object.hasOwn(values, key)) target.delete(key);
    for (const [key, value] of Object.entries(values)) if (!same(target.get(key), value)) target.set(key, value);
  };
  const patchArray = <T,>(target: Y.Array<unknown>, values: T[], key: (value: T) => string) => {
    const wanted = new Map(values.map((value) => [key(value), value]));
    const current = target.toArray() as T[];
    for (let index = current.length - 1; index >= 0; index--) {
      const id = key(current[index]);
      if (!wanted.has(id)) target.delete(index, 1);
      else {
        const value = wanted.get(id)!;
        if (!same(current[index], value)) { target.delete(index, 1); target.insert(index, [value]); }
        wanted.delete(id);
      }
    }
    if (wanted.size) target.insert(target.length, [...wanted.values()]);
  };
  doc.transact(() => {
    patchMap(documentFields(doc), snapshot.content.fields);
    patchArray(documentTags(doc), snapshot.content.tags, (tag) => tag);
    patchArray(documentAssets(doc), snapshot.content.assets, (asset) => asset.id);
    const presentation = documentPresentation(doc);
    if (presentation.get("templateId") !== snapshot.presentation.template.id) presentation.set("templateId", snapshot.presentation.template.id);
    if (presentation.get("templateVersion") !== snapshot.presentation.template.version) presentation.set("templateVersion", snapshot.presentation.template.version);
    patchMap(documentTheme(doc), snapshot.presentation.theme);
  }, origin);
}
