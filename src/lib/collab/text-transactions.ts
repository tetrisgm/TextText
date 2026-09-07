import * as Y from "yjs";
import { MAX_TEXT_CHUNK_UNITS } from "./limits";

const historyGroup = Symbol("texttext-history-group");
const managers = new WeakMap<Y.Doc, Set<DocumentUndoManager>>();

/** Keep bounded CRDT history items, but expose one user action to undo/redo. */
export class DocumentUndoManager extends Y.UndoManager {
  constructor(scope: Y.Map<unknown>, options: ConstructorParameters<typeof Y.UndoManager>[1]) {
    super(scope, options);
    const doc = scope.doc!;
    const set = managers.get(doc) ?? new Set<DocumentUndoManager>();
    set.add(this);
    managers.set(doc, set);
  }

  override destroy() {
    managers.get(this.doc)?.delete(this);
    super.destroy();
  }

  private move(direction: "undo" | "redo") {
    const from = direction === "undo" ? this.undoStack : this.redoStack;
    const to = direction === "undo" ? this.redoStack : this.undoStack;
    const group = from.at(-1)?.meta.get(historyGroup);
    let result: ReturnType<Y.UndoManager["undo"]> = null;
    do {
      const count = to.length;
      const item = direction === "undo" ? super.undo() : super.redo();
      result ??= item;
      if (group && to.length > count) to.at(-1)!.meta.set(historyGroup, group);
    } while (group && from.length && from.at(-1)?.meta.get(historyGroup) === group);
    return result;
  }

  override undo() { return this.move("undo"); }
  override redo() { return this.move("redo"); }
}

/** No awaits: browser input/network callbacks cannot interleave with a paste.
 * Never wrap this in doc.transact: Yjs flattens nested transactions. */
export function transactTextChanges(doc: Y.Doc, origin: unknown, steps: Generator<void>): void {
  const group = Symbol("text-action");
  const histories = [...(managers.get(doc) ?? [])].filter((manager) => manager.trackedOrigins.has(origin));
  const timeouts = histories.map((manager) => manager.captureTimeout);
  for (const manager of histories) { manager.stopCapturing(); manager.captureTimeout = 0; }
  try {
    let done = false;
    while (!done) {
      const counts = histories.map((manager) => manager.undoStack.length);
      doc.transact(() => { done = steps.next().done === true; }, origin);
      histories.forEach((manager, index) => {
        if (manager.undoStack.length > counts[index]) manager.undoStack.at(-1)!.meta.set(historyGroup, group);
      });
    }
  } finally {
    histories.forEach((manager, index) => { manager.captureTimeout = timeouts[index]; manager.stopCapturing(); });
  }
}

function boundary(value: string, end: number): number {
  if (end > 0 && end < value.length &&
      value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff &&
      value.charCodeAt(end) >= 0xdc00 && value.charCodeAt(end) <= 0xdfff) return end - 1;
  return end;
}

/** Split on Unicode scalar boundaries. Also bound deletions so undo cannot
 * restore an arbitrarily large old string in one transaction. */
export function* spliceText(target: Y.Text, start: number, deleteCount: number, insertion: string): Generator<void> {
  if (deleteCount + insertion.length <= MAX_TEXT_CHUNK_UNITS) {
    if (deleteCount) target.delete(start, deleteCount);
    if (insertion) target.insert(start, insertion);
    if (deleteCount || insertion) yield;
    return;
  }
  const old = deleteCount ? target.toString().slice(start, start + deleteCount) : "";
  let remaining = old.length;
  while (remaining) {
    const from = boundary(old, Math.max(0, remaining - MAX_TEXT_CHUNK_UNITS));
    target.delete(start + from, remaining - from);
    remaining = from;
    yield;
  }
  for (let offset = 0; offset < insertion.length;) {
    const end = boundary(insertion, Math.min(insertion.length, offset + MAX_TEXT_CHUNK_UNITS));
    target.insert(start + offset, insertion.slice(offset, end));
    offset = end;
    yield;
  }
}

/** Editor and pre-ready reconciliation use the same insertion choke point as
 * snapshots and agent mutations. Small input retains the normal typing group. */
export function replaceSharedText(target: Y.Text, start: number, deleteCount: number, insertion: string, origin: unknown): void {
  if (!target.doc) throw new Error("Shared text must belong to a document.");
  if (deleteCount + insertion.length <= MAX_TEXT_CHUNK_UNITS) {
    target.doc.transact(() => {
      if (deleteCount) target.delete(start, deleteCount);
      if (insertion) target.insert(start, insertion);
    }, origin);
  } else {
    transactTextChanges(target.doc, origin, spliceText(target, start, deleteCount, insertion));
  }
}
