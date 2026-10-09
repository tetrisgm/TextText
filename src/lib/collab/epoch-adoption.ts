import { diffChars } from "diff";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { externalBodyEdits, reconcileDocumentSnapshots } from "@/sync/engine/reconcile";

/**
 * Live adoption of a replacement Yjs epoch: the mounted editor keeps its
 * element while its Y.Doc is swapped for the merged replacement.
 *
 * Two pure pieces live here. `mapTextOffset` carries a caret from the old
 * text into the merged text. `EpochUndoHistory` keeps the steps recorded on
 * the old document as text states and replays them on the new document
 * through the shared three-way reconcile, so a later remote edit survives an
 * undo that crosses the adoption. Yjs stack items cannot move between
 * documents: their delete sets name the old client identities.
 */

const HISTORY_LIMIT = 100;
const ORIGIN = "epoch-adoption-history";

/** Map a caret offset in `before` to the same place in `after` by character diff.
 * Text inserted exactly at the offset stays after it (`before`), except text
 * appended at the end, which a caret at the end follows; `after` places the
 * offset behind any text inserted there. */
export function mapTextOffset(before: string, after: string, offset: number, insertionsAtOffset: "before" | "after" = "before"): number {
  const clamped = Math.max(0, Math.min(before.length, offset));
  if (before === after) return clamped;
  let consumed = 0, produced = 0;
  for (const part of diffChars(before, after)) {
    const length = part.value.length;
    if (part.added) {
      if (consumed < clamped || (consumed === clamped && (insertionsAtOffset === "after" || (clamped > 0 && clamped === before.length)))) produced += length;
      continue;
    }
    if (part.removed) {
      if (clamped <= consumed + length) return produced;
      consumed += length;
      continue;
    }
    if (clamped < consumed + length) return produced + (clamped - consumed);
    consumed += length; produced += length;
  }
  return Math.min(after.length, produced);
}

export type TextSelection = { anchor: number; head: number };
export function mapSelection(before: string, after: string, selection: TextSelection): TextSelection {
  return { anchor: mapTextOffset(before, after, selection.anchor), head: mapTextOffset(before, after, selection.head) };
}

/** Where the caret lands after a history step rewrote `before` into `after`: the end of the changed region. */
export function caretAfterBodyChange(before: string, after: string): number {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  return after.length - suffix;
}

type UndoLike = {
  undoStack: unknown[]; redoStack: unknown[];
  undo(): unknown; redo(): unknown;
};

/** States recorded on the old document: `undo[0]` is one step before `current`. */
export type CapturedHistory = { current: DocumentSnapshot; undo: DocumentSnapshot[]; redo: DocumentSnapshot[] };

/**
 * Walk an undo manager that still binds the old document and record the text
 * state each step produces. The old document is discarded afterwards, so the
 * walk may leave it anywhere.
 */
export function captureUndoHistory(manager: UndoLike, snapshot: () => DocumentSnapshot | null): CapturedHistory | null {
  const current = snapshot();
  if (!current) return null;
  const undo: DocumentSnapshot[] = [], redo: DocumentSnapshot[] = [];
  const forward = manager.redoStack.length;
  let back = 0;
  while (manager.undoStack.length && undo.length < HISTORY_LIMIT) {
    if (!manager.undo()) break;
    back += 1;
    const state = snapshot(); if (!state) return null;
    undo.push(state);
  }
  for (let step = 0; step < back; step += 1) manager.redo();
  if (JSON.stringify(snapshot()) !== JSON.stringify(current)) return { current, undo, redo: [] };
  for (let step = 0; step < forward && redo.length < HISTORY_LIMIT; step += 1) {
    if (!manager.redo()) break;
    const state = snapshot(); if (!state) break;
    redo.push(state);
  }
  return { current, undo, redo };
}

export type BodyEdit = { start: number; end: number; replacement: string };
export type HistoryStep = { document: DocumentSnapshot; bodyEdits: BodyEdit[] | null };

/** The character edits that turn `from` into `to`, in `from` coordinates, left to right. */
export function bodyEditsBetween(from: string, to: string): BodyEdit[] {
  const edits: BodyEdit[] = [];
  let offset = 0;
  for (const part of diffChars(from, to)) {
    const last = edits.at(-1);
    if (part.added) {
      if (last && last.end === offset && last.replacement === "") last.replacement = part.value;
      else edits.push({ start: offset, end: offset, replacement: part.value });
    } else if (part.removed) {
      if (last && last.end === offset && last.start < last.end && last.replacement === "") last.end += part.value.length;
      else edits.push({ start: offset, end: offset + part.value.length, replacement: "" });
      offset += part.value.length;
    } else offset += part.value.length;
  }
  return edits;
}

/**
 * Re-express the body edits of a recorded step on the live body. A removal
 * must still find its exact text; an insertion goes behind anything that
 * arrived at the same place, which is where the adoption merge put it.
 * Returns null when later edits changed the text the step removes.
 */
export function replayBodyEdits(from: string, to: string, live: string): { body: string; edits: BodyEdit[] } | null {
  if (from === live) return { body: to, edits: bodyEditsBetween(from, to) };
  const edits: BodyEdit[] = [];
  for (const edit of bodyEditsBetween(from, to)) {
    const removed = from.slice(edit.start, edit.end);
    if (!removed) { const at = mapTextOffset(from, live, edit.start, "after"); edits.push({ start: at, end: at, replacement: edit.replacement }); continue; }
    const candidates = [mapTextOffset(from, live, edit.start), mapTextOffset(from, live, edit.end) - removed.length];
    const start = candidates.find(at => at >= 0 && live.slice(at, at + removed.length) === removed);
    if (start === undefined) return null;
    edits.push({ start, end: start + removed.length, replacement: edit.replacement });
  }
  for (let index = 1; index < edits.length; index += 1) if (edits[index].start < edits[index - 1].end) return null;
  let body = live;
  for (const edit of [...edits].reverse()) body = body.slice(0, edit.start) + edit.replacement + body.slice(edit.end);
  return { body, edits };
}

function withoutBody(document: DocumentSnapshot): string {
  return JSON.stringify({ ...document, content: { ...document.content, body: "" } });
}

/**
 * Express the transition `from -> to`, recorded on the old document, against
 * the live document `live`. Returns null when the recorded step conflicts
 * with later edits; the caller then reports that history ended.
 */
export function replayHistoryStep(from: DocumentSnapshot, to: DocumentSnapshot, live: DocumentSnapshot): HistoryStep | null {
  if (JSON.stringify(from) === JSON.stringify(live)) return { document: to, bodyEdits: null };
  if (withoutBody(from) === withoutBody(to)) {
    // A body-only step: character edits survive neighbouring remote text that
    // the shared three-way reconcile would report as a conflict.
    const replayed = replayBodyEdits(from.content.body, to.content.body, live.content.body);
    if (!replayed) return null;
    return { document: { ...live, content: { ...live.content, body: replayed.body } }, bodyEdits: replayed.edits };
  }
  const merged = reconcileDocumentSnapshots(from, to, live, { concurrentInsertions: "remote-first" });
  if (merged.status !== "merged") return null;
  const bodyEdits = externalBodyEdits(from.content.body, live.content.body, to.content.body, merged.document.content.body) ?? null;
  return { document: merged.document, bodyEdits };
}

/**
 * Undo and redo across an adoption. The editor consults the Yjs stacks first
 * for steps recorded on the live document; this history supplies the earlier
 * steps and keeps the interleaving order so redo retraces undo exactly.
 */
export class EpochUndoHistory {
  /** Order of the steps undone so far, newest last. */
  private undone: ("live" | "captured")[] = [];
  private undo: DocumentSnapshot[];
  private redo: DocumentSnapshot[];
  private cursor: DocumentSnapshot;
  private exhausted = false;
  static readonly origin = ORIGIN;
  constructor(captured: CapturedHistory) {
    this.undo = [...captured.undo]; this.redo = [...captured.redo]; this.cursor = captured.current;
  }
  get canUndo(): boolean { return !this.exhausted && this.undo.length > 0; }
  get canRedo(): boolean { return this.undone.length > 0 || this.redo.length > 0; }
  /** The editor recorded a live undo; remember it so redo retraces it in order. */
  noteLiveUndo(): void { this.undone.push("live"); }
  noteLiveRedo(): void { if (this.undone.at(-1) === "live") this.undone.pop(); }
  /** A fresh edit discards every redo path, exactly as the Yjs manager does. */
  noteEdit(): void { this.undone = []; this.redo = []; }
  /** Which mechanism the next redo must use, or null when nothing is redoable. */
  nextRedo(): "live" | "captured" | null {
    if (this.undone.length) return this.undone.at(-1)!;
    return this.redo.length ? "captured" : null;
  }
  /** Compute the captured undo step against the live document. */
  stepBack(live: DocumentSnapshot): HistoryStep | null {
    if (!this.canUndo) return null;
    const target = this.undo[0];
    const step = replayHistoryStep(this.cursor, target, live);
    if (!step) { this.exhausted = true; return null; }
    this.redo.unshift(this.cursor); this.undo.shift(); this.cursor = target; this.undone.push("captured");
    return step;
  }
  stepForward(live: DocumentSnapshot): HistoryStep | null {
    if (this.nextRedo() !== "captured") return null;
    const target = this.redo[0];
    const step = replayHistoryStep(this.cursor, target, live);
    if (!step) { this.redo = []; this.undone = this.undone.filter(kind => kind !== "captured"); return null; }
    this.undo.unshift(this.cursor); this.redo.shift(); this.cursor = target;
    if (this.undone.at(-1) === "captured") this.undone.pop();
    return step;
  }
}
