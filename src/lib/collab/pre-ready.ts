import { spliceText, transactTextChanges } from "./text-transactions";
import * as Y from "yjs";
import { applyDocumentBaseline, documentText, documentAssets, documentFields, documentPresentation, documentTags, documentTheme } from "@/lib/collab/document";
import type { DocumentSnapshot } from "@/lib/documents/model";

type Hunk = { start: number; end: number; insert: string };

/** Immutable identities from the actual startup history, not a caught-up string. */
export type PreReadyTextBaseline = {
  text: string;
  keys: string[];
  type: string;
  clocks: Map<number, number>;
};

export function capturePreReadyTextBaseline(target: Y.Text): PreReadyTextBaseline {
  const text = target.toString();
  const ids: string[] = [];
  const clocks = new Map<number, number>();
  // Walk Yjs runs once. Relative positions per character would repeatedly scan
  // the text. Only read the pinned Yjs Item layout; never mutate its internals.
  for (let item = target._start; item; item = item.right) {
    if (item.deleted || !item.countable) continue;
    if (!(item.content instanceof Y.ContentString)) throw new Error("Pre-ready text merge needs recovery");
    clocks.set(item.id.client, Math.max(clocks.get(item.id.client) ?? 0, item.id.clock + item.length));
    for (let offset = 0; offset < item.length; offset++) ids.push(`${item.id.client}:${item.id.clock + offset}`);
  }
  let offset = 0;
  const keys = Array.from(text, (point) => {
    const key = ids.slice(offset, offset + point.length).join("/");
    offset += point.length;
    return key;
  });
  const position = Y.createRelativePositionFromTypeIndex(target, 0);
  return { text, keys, type: JSON.stringify([position.type, position.tname]), clocks };
}

/** Reconstruct the server's deterministic startup revision in an isolated doc.
 * Never seed the live doc just to give a plain snapshot apparent identities. */
export function capturePreReadyDocumentBaseline(snapshot: DocumentSnapshot, seed: string) {
  const baseline = new Y.Doc();
  try {
    applyDocumentBaseline(baseline, snapshot, seed);
    return {
      title: capturePreReadyTextBaseline(documentText(baseline, "title")),
      subtitle: capturePreReadyTextBaseline(documentText(baseline, "subtitle")),
      body: capturePreReadyTextBaseline(documentText(baseline, "body")),
    };
  } finally {
    baseline.destroy();
  }
}

const inferredPlans = new WeakMap<Hunk[], { baseline: string; local: string; remote: string }>();

/** Myers diff over complete code points (or their identities), with UTF-16 output offsets.
 * Trim the common edges so a small edit in a large document stays cheap.
 * Bound divergent input; the caller keeps the ledger for explicit recovery
 * instead of guessing a destructive replacement or freezing the editor. */
function textHunks(before: string, after: string, beforeKeys?: string[], afterKeys?: string[]): Hunk[] {
  const beforePoints = Array.from(before), afterPoints = Array.from(after);
  const left = beforeKeys ?? beforePoints, rightKeys = afterKeys ?? afterPoints;
  const offsets = [0];
  for (const point of beforePoints) offsets.push(offsets[offsets.length - 1] + point.length);
  let prefix = 0;
  while (prefix < left.length && prefix < rightKeys.length && left[prefix] === rightKeys[prefix]) prefix++;
  let endBefore = left.length, endAfter = rightKeys.length;
  while (endBefore > prefix && endAfter > prefix && left[endBefore - 1] === rightKeys[endAfter - 1]) {
    endBefore--; endAfter--;
  }
  const a = left.slice(prefix, endBefore), b = rightKeys.slice(prefix, endAfter);
  if (!a.length || !b.length) {
    return !a.length && !b.length ? [] : [{ start: offsets[prefix], end: offsets[endBefore], insert: afterPoints.slice(prefix, endAfter).join("") }];
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
          if (!active) { active = { start: offsets[ai], end: offsets[ai], insert: "" }; hunks.push(active); }
          if (step === "delete") { ai++; active.end = offsets[ai]; }
          else { active.insert += afterPoints[bi++]; }
        }
        return hunks;
      }
    }
    frontier = next;
  }
  throw new Error("Pre-ready text merge needs recovery");
}

/** Plan local operations on the caught-up text. Delete only surviving baseline
 * identities when an identity baseline is supplied. Overlapping replacements keep both
 * insertions (remote then local); identical hunks are already satisfied.
 * The returned operations use remote offsets and run right to left, preserving
 * every untouched remote CRDT identity for subsequent peer deletions. */
export function preReadyTextOperations(
  baseline: string, local: string, remote: string,
  identity?: { baseline: PreReadyTextBaseline; target: Y.Text },
): Hunk[] {
  if (local === baseline || local === remote) return [];
  const localHunks = textHunks(baseline, local);
  let remoteHunks: Hunk[];
  if (identity) {
    const current = capturePreReadyTextBaseline(identity.target);
    if (current.text !== remote || identity.baseline.text !== baseline) throw new Error("Pre-ready text merge needs recovery");
    const state = Y.decodeStateVector(Y.encodeStateVector(identity.target.doc!));
    const known = identity.baseline.type === current.type &&
      [...identity.baseline.clocks].every(([client, clock]) => (state.get(client) ?? 0) >= clock);
    if (!known) {
      // The plain page snapshot belongs to another history. Insertions can be
      // positioned by text, but no character is proven safe to delete.
      if (localHunks.some((h) => h.end > h.start)) throw new Error("Pre-ready text merge needs recovery");
      remoteHunks = textHunks(baseline, remote);
    } else {
      remoteHunks = textHunks(baseline, remote, identity.baseline.keys, current.keys);
    }
  } else {
    remoteHunks = textHunks(baseline, remote);
  }
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
  // Reverse source order first: stable sorting then applies later insertions
  // first when remote deletions collapse multiple source positions together.
  operations.reverse().sort((a, b) => b.start - a.start || b.end - a.end);
  if (!identity) inferredPlans.set(operations, { baseline, local, remote });
  return operations;
}

/** String-only plans are advisory. Return false, without mutation, when Yjs
 * history or non-unique string alignment makes their deletions untrustworthy.
 * The editor uses identity plans and preflights all fields before application. */
export function applyPreReadyTextOperations(target: Y.Text, operations: Hunk[], origin: unknown): boolean {
  const inferred = inferredPlans.get(operations);
  if (inferred && operations.some((h) => h.end > h.start)) {
    if (target.toString() !== inferred.remote) return false;
    // Even identical visible text may have entirely new identities. Tombstones
    // remain evidence after Yjs collects their old string content.
    for (let item = target._start; item; item = item.right) if (item.deleted) return false;
    // Check the opposite alignment too. Repeated characters can shift a hunk
    // across a peer insertion while producing the same visible edit.
    const reverse = (value: string) => Array.from(value).reverse().join("");
    const forward = textHunks(inferred.baseline, inferred.remote);
    const backward = textHunks(reverse(inferred.baseline), reverse(inferred.remote))
      .map((h) => ({ start: inferred.baseline.length - h.end, end: inferred.baseline.length - h.start, insert: reverse(h.insert) })).reverse();
    if (JSON.stringify(forward) !== JSON.stringify(backward)) return false;
  }
  if (target.doc) transactTextChanges(target.doc, origin, (function* () {
    for (const h of operations) yield* spliceText(target, h.start, h.end - h.start, h.insert);
  })());
  return true;
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
