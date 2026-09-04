"use client";

// The writing surface for the body.
//
// The body is Markdown and stays Markdown: `content.body` is a string, the Y
// document holds it as a `Y.Text`, and materialization, sync, the agent caret
// helpers and every stored baseline depend on that. What was wrong was not the
// model, it was that the editor showed a different document than the reader
// got: a heading was `## Create` while writing and a heading while reading.
//
// This renders the source itself, styled. Because the styled text IS the
// editable layer rather than an overlay behind a transparent textarea,
// headings can be a different size without breaking anything, the caret is the
// browser's own, and IME composition works because a real editable element is
// doing the composing.
//
// Four decisions are load-bearing and should survive any rewrite:
//
// 1. The concatenation of prefix + editable DOM text + suffix is exactly the
//    source. Below the windowing threshold prefix and suffix are empty and
//    `textContent` IS the source: every child is a line row of inline
//    content, newlines are literal characters, and remote-caret markers carry
//    no text.
// 2. The local selection is restored ONLY when the nodes it lives in were
//    rebuilt. A peer's caret arriving re-renders this component about once a
//    second, and restoring on every render collapses whatever the writer had
//    selected, mid-drag. Selection.removeAllRanges/addRange on a large
//    editable is also expensive native work: a keystroke whose line renders
//    to an identical wrapper keeps the live wrapper and the browser's caret.
// 3. Work per keystroke is proportional to the CHANGED LINES, never to the
//    buffer. The reconciler diffs by line and splices only the wrappers whose
//    line text or caret overlay changed, with a rebuild kept as the
//    correctness net for any DOM state it does not recognize.
// 4. Past WINDOW_THRESHOLD only the lines near the viewport are materialized,
//    between two non-editable spacers. A whole-document contenteditable costs
//    the browser's own editing machinery ~30ms per keystroke at 1MB (WebKit:
//    much worse) no matter how little JS runs; native cost must scale with
//    the window, not the document. content-visibility:auto is NOT the tool
//    for this: it took WebKit to four SECONDS per keystroke and Chromium
//    scrolling to 13fps. Never bring it back.

import { useEffect, useLayoutEffect, useRef } from "react";
import { DOCUMENT_JUMP_EVENT } from "@/lib/document-outline";
import {
  DOCUMENT_SET_CARET_EVENT,
  setActiveBodySelection,
} from "@/lib/document-history-events";

export type SurfaceSelection = {
  clientId: number;
  userName: string;
  color: string;
  from: number;
  to: number;
};

export type Segment = { text: string; className?: string; line?: number };

const MARKER = "tt-md-marker";
/**
 * Syntax whose meaning the styling already carries, so it can recede.
 *
 * A heading is large, strong text is bold, code is mono: the reader learns
 * nothing from `##` or `**` that the type does not already say. A list bullet
 * and a quote bar are different. Nothing else on the line says "list", so
 * hiding `- ` turns a list into a run of paragraphs, which is a change of
 * meaning rather than a change of noise. Those markers stay.
 */
const SYNTAX = "tt-md-syntax";
/** A marker on the line the caret is in. Hidden markers stay in the source. */
const MARKER_OPEN = "is-open";
/** The per-line wrapper marker. Inline, so textContent stays exact. */
const LINE_ATTR = "data-tt-ln";
/** The windowing spacers standing in for non-materialized lines. */
const SPACER_ATTR = "data-tt-spacer";
/** Breathing room above a jumped-to line, so it is not flush with the top. */
const JUMP_MARGIN_PX = 12;
/**
 * Past this size the system spellchecker becomes an input-latency source of
 * its own on a contenteditable (isolating that took the fast-editor crowd
 * days; no reason to rediscover it). Notes keep their squiggles.
 */
const SPELLCHECK_LIMIT = 40_000;
/**
 * Bodies at or past this size render windowed. At 100kB the whole-document
 * editable already types at textarea parity, so the threshold sits above
 * every ordinary document and the simple mode keeps carrying them.
 */
const WINDOW_THRESHOLD = 150_000;
/** Materialized lines beyond each edge of the viewport. */
const OVERSCAN_LINES = 80;
/** Row-height estimate before anything has been measured. */
const DEFAULT_ROW_PX = 26;

function headingClass(hashes: number): string {
  return `tt-md-h${Math.min(hashes, 4)}`;
}

/** Styled segments for one line, in source order. Purely presentational. */
function segmentsForLine(line: string): Segment[] {
  const heading = /^(\s*)(#{1,6})(\s+)(.*)$/.exec(line);
  if (heading) {
    const cls = headingClass(heading[2].length);
    return [
      {
        text: `${heading[1]}${heading[2]}${heading[3]}`,
        className: `${MARKER} ${SYNTAX} ${cls}`,
      },
      { text: heading[4], className: cls },
    ];
  }
  const quote = /^(\s*>\s?)(.*)$/.exec(line);
  if (quote) {
    return [
      { text: quote[1], className: `${MARKER} tt-md-quote` },
      ...inlineSegments(quote[2]).map((segment) => ({
        ...segment,
        className: `${segment.className ?? ""} tt-md-quote`.trim(),
      })),
    ];
  }
  const list = /^(\s*(?:[-*+]|\d+\.)\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line);
  if (list) {
    const out: Segment[] = [{ text: list[1], className: MARKER }];
    if (list[2]) out.push({ text: list[2], className: MARKER });
    out.push(...inlineSegments(list[3]));
    return out;
  }
  return inlineSegments(line);
}

/** Emphasis and code, marked so the syntax recedes and the words stand out. */
function inlineSegments(text: string): Segment[] {
  const out: Segment[] = [];
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|(`)([^`]+?)(`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push({ text: text.slice(last, match.index) });
    const syntax = `${MARKER} ${SYNTAX}`;
    if (match[1]) {
      out.push({ text: match[1], className: syntax });
      out.push({ text: match[2], className: "tt-md-strong" });
      out.push({ text: match[1], className: syntax });
    } else if (match[3]) {
      out.push({ text: match[3], className: syntax });
      out.push({ text: match[4], className: "tt-md-em" });
      out.push({ text: match[3], className: syntax });
    } else {
      out.push({ text: match[5], className: syntax });
      out.push({ text: match[6], className: "tt-md-code" });
      out.push({ text: match[7], className: syntax });
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/**
 * Every segment of the whole body, newlines included as literal text.
 *
 * Exported for its INVARIANT, which is the load-bearing property of this whole
 * surface: the segments concatenate back to exactly the input, in order. Every
 * character offset in the product rides on that. The agent edits by range, the
 * Y.Text holds the same string, remote carets are absolute offsets, and
 * `if_match_hash` hashes it. A segmenter that drops or invents one character
 * moves all of them while the document still looks right.
 */
export function segmentsForValue(value: string): Segment[] {
  const out: Segment[] = [];
  const lines = value.split("\n");
  lines.forEach((line, index) => {
    for (const segment of segmentsForLine(line)) {
      out.push({ ...segment, line: index });
    }
    if (index < lines.length - 1) out.push({ text: "\n", line: index });
  });
  return out;
}

/** The lines of a value, with [] for the empty document. */
function linesOf(value: string): string[] {
  return value.length === 0 ? [] : value.split("\n");
}

/** Absolute start offset of each line (its "\n" belongs to the line). */
function lineStartsOf(lines: readonly string[]): number[] {
  const starts = new Array<number>(lines.length);
  let at = 0;
  for (let i = 0; i < lines.length; i += 1) {
    starts[i] = at;
    at += lines[i].length + 1;
  }
  return starts;
}

/** Which line an absolute offset falls on: binary search over line starts. */
function lineAtOffset(starts: readonly number[], offset: number): number {
  if (starts.length === 0) return 0;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * What besides its text makes a line render differently: the remote carets
 * sitting on it and the peer ranges crossing it. A line whose text and
 * signature both held still renders to an identical wrapper and is skipped.
 */
export function lineOverlaySignatures(
  lines: readonly string[],
  starts: readonly number[],
  selections: readonly SurfaceSelection[],
): string[] {
  const sigs = new Array<string>(lines.length).fill("");
  if (selections.length === 0 || lines.length === 0) return sigs;
  const append = (line: number, part: string) => {
    if (line >= 0 && line < sigs.length) sigs[line] += part;
  };
  for (const s of selections) {
    const from = Math.max(0, s.from);
    const first = lineAtOffset(starts, from);
    if (s.from === s.to) {
      append(first, `c${s.clientId}:${s.from}:${s.color}:${s.userName};`);
      continue;
    }
    const last = lineAtOffset(starts, Math.max(from, s.to - 1));
    for (let line = first; line <= last; line += 1) {
      append(line, `r${s.clientId}:${s.from}:${s.to}:${s.color};`);
    }
  }
  return sigs;
}

/**
 * The one contiguous run of lines that changed between two renders, as a
 * splice: replace old[start..oldEnd) with new[start..newEnd). Equal arrays
 * produce an empty splice at 0.
 */
export function lineSplice(
  previous: readonly string[],
  next: readonly string[],
  previousSigs?: readonly string[],
  nextSigs?: readonly string[],
): { start: number; oldEnd: number; newEnd: number } {
  // Lines and overlay signatures are compared side by side rather than as
  // concatenated keys: building 2x25k joined strings per keystroke was pure
  // allocation (and young-GC) cost at large bodies.
  const same = (i: number, j: number): boolean =>
    previous[i] === next[j] &&
    (previousSigs?.[i] ?? "") === (nextSigs?.[j] ?? "");
  let start = 0;
  const max = Math.min(previous.length, next.length);
  while (start < max && same(start, start)) start += 1;
  let oldEnd = previous.length;
  let newEnd = next.length;
  while (oldEnd > start && newEnd > start && same(oldEnd - 1, newEnd - 1)) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  return { start, oldEnd, newEnd };
}

/**
 * The materialized window [start, end) that keeps `line` comfortably inside
 * it, sized for the viewport plus overscan on both edges.
 */
export function windowAround(
  line: number,
  lineCount: number,
  viewportLines: number,
): { start: number; end: number } {
  const span = Math.max(viewportLines, 1) + OVERSCAN_LINES * 2;
  let start = Math.max(0, line - Math.floor(span / 2));
  let end = Math.min(lineCount, start + span);
  start = Math.max(0, Math.min(start, end - span));
  if (start < 0) start = 0;
  if (end > lineCount) end = lineCount;
  return { start, end };
}

/** Absolute character offset of a DOM position, walking only one wrapper. */
function offsetWithin(scope: Node, node: Node, nodeOffset: number): number {
  if (node === scope) {
    let total = 0;
    for (let i = 0; i < nodeOffset && i < scope.childNodes.length; i += 1) {
      total += scope.childNodes[i].textContent?.length ?? 0;
    }
    return total;
  }
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === node) return total + nodeOffset;
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return total;
}

/** The DOM position for a character offset inside one scope element. */
function positionWithin(
  scope: HTMLElement,
  offset: number,
): { node: Node; offset: number } {
  // Offset 0 belongs at the row's own start: on an empty row the first text
  // node is the zero-height newline, and a caret parked inside it vanishes.
  if (offset === 0) return { node: scope, offset: 0 };
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let current = walker.nextNode();
  let last: Node | null = null;
  while (current) {
    const length = current.textContent?.length ?? 0;
    if (remaining <= length) return { node: current, offset: remaining };
    remaining -= length;
    last = current;
    current = walker.nextNode();
  }
  return last
    ? { node: last, offset: last.textContent?.length ?? 0 }
    : { node: scope, offset: 0 };
}

/** The nearest ancestor that actually scrolls this surface, if any. */
function scrollerOf(root: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = root.parentElement;
  while (el) {
    if (el.scrollHeight > el.clientHeight + 4) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") {
        return el;
      }
    }
    el = el.parentElement;
  }
  return null;
}

export function MarkdownSurface({
  value,
  placeholder,
  label,
  selections,
  onChange,
  onSelection,
  surfaceRef,
}: {
  value: string;
  placeholder: string;
  label: string;
  selections: SurfaceSelection[];
  onChange: (value: string) => void;
  onSelection: (anchor: number, head: number) => void;
  surfaceRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const localRef = useRef<HTMLDivElement>(null);
  const ref = surfaceRef ?? localRef;
  const composingRef = useRef(false);
  const draggingRef = useRef(false);
  const rangeRef = useRef<{ anchor: number; head: number } | null>(null);

  // The reconciled model: ALL lines and their absolute starts, one wrapper
  // element per MATERIALIZED line in document order, and the overlay
  // signature each wrapper was built with. These stay in lockstep with the
  // DOM between renders. wrappersRef[slot] renders line winRef.start + slot.
  const linesRef = useRef<string[]>([]);
  const lineStartsRef = useRef<number[]>([]);
  const wrappersRef = useRef<HTMLElement[]>([]);
  const overlaySigsRef = useRef<string[]>([]);
  const openLineRef = useRef<number | null>(null);
  const builtRef = useRef<string | null>(null);
  /** Where the caret must land after a controlled structural edit. */
  const pendingCaretRef = useRef<number | null>(null);

  // Windowing state. In whole-document mode the window is [0, lines.length),
  // the spacers do not exist, and prefix/suffix are empty strings.
  const winRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const windowedRef = useRef(false);
  const topSpacerRef = useRef<HTMLElement | null>(null);
  const bottomSpacerRef = useRef<HTMLElement | null>(null);
  /** Source text of the lines before/after the window, exact. */
  const prefixRef = useRef("");
  const suffixRef = useRef("");
  const rowPxRef = useRef(DEFAULT_ROW_PX);
  /** Cmd+A in windowed mode: the whole document is selected, not the DOM. */
  const allSelectedRef = useRef(false);
  const skipSelectionClearRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  /**
   * The lines of the value publish() just produced, derived incrementally:
   * splitting a multi-megabyte string on every keystroke was the largest
   * remaining O(document) cost, and only the window's text can have changed.
   */
  const pendingModelRef = useRef<{ value: string; lines: string[] } | null>(
    null,
  );

  /** The wrapper an event-target node lives in, or null for stray nodes. */
  const wrapperOf = (node: Node): { el: HTMLElement; slot: number } | null => {
    let current: Node | null = node;
    const root = ref.current;
    while (current && current !== root) {
      if (
        current instanceof HTMLElement &&
        current.hasAttribute(LINE_ATTR) &&
        current.parentNode === root
      ) {
        const slot = wrappersRef.current.indexOf(current);
        return slot >= 0 ? { el: current, slot } : null;
      }
      current = current.parentNode;
    }
    return null;
  };

  /**
   * Selection offsets, walking only the wrapper the selection sits in rather
   * than the whole document. Every caret move used to pay a full-document
   * text walk, which alone was enough to make arrow keys lag on big bodies.
   * Falls back to a full walk for DOM the reconciler has not normalized yet.
   */
  const selectionOffsets = (): { anchor: number; head: number } | null => {
    if (allSelectedRef.current) {
      return { anchor: 0, head: valueRef.current.length };
    }
    const root = ref.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;
    const at = (node: Node, nodeOffset: number): number => {
      if (node === root) {
        let total = 0;
        for (let i = 0; i < nodeOffset && i < root.childNodes.length; i += 1) {
          total += root.childNodes[i].textContent?.length ?? 0;
        }
        return prefixRef.current.length + total;
      }
      const wrapper = wrapperOf(node);
      if (wrapper) {
        const line = winRef.current.start + wrapper.slot;
        return (
          (lineStartsRef.current[line] ?? 0) +
          offsetWithin(wrapper.el, node, nodeOffset)
        );
      }
      return prefixRef.current.length + offsetWithin(root, node, nodeOffset);
    };
    return {
      anchor: at(range.startContainer, range.startOffset),
      head: at(range.endContainer, range.endOffset),
    };
  };

  /**
   * Show the syntax of the line the caret is on, and only that line. Scoped
   * to the two affected wrappers; the markers stay in the DOM either way, so
   * `textContent` and every absolute offset are unmoved. Lines are absolute;
   * one outside the materialized window has no markers to show.
   */
  const revealLine = (line: number | null) => {
    const wrappers = wrappersRef.current;
    const previous = openLineRef.current;
    if (previous === line) return;
    const slotOf = (l: number) => l - winRef.current.start;
    if (previous !== null) {
      const el = wrappers[slotOf(previous)];
      if (el?.isConnected) {
        for (const marker of el.querySelectorAll<HTMLElement>(`.${SYNTAX}`)) {
          marker.classList.remove(MARKER_OPEN);
        }
      }
    }
    if (line !== null) {
      const el = wrappers[slotOf(line)];
      if (el?.isConnected) {
        for (const marker of el.querySelectorAll<HTMLElement>(`.${SYNTAX}`)) {
          marker.classList.add(MARKER_OPEN);
        }
      }
    }
    openLineRef.current = line;
  };

  const reportSelection = () => {
    const at = selectionOffsets();
    if (!at) return;
    rangeRef.current = at;
    // Undo needs to know where the caret was when a step was recorded.
    setActiveBodySelection(at);
    revealLine(lineAtOffset(lineStartsRef.current, at.head));
    onSelection(at.anchor, at.head);
  };

  // Undo puts the caret back where the edit happened, the way Sublime does.
  // pendingCaretRef is the surface's own "place the caret on the next
  // reconcile" channel, and the value change from the CRDT is what triggers
  // that reconcile, so setting it here lands the caret with the undone text.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ anchor?: number; head?: number }>)
        .detail;
      const head = detail?.head;
      if (typeof head !== "number") return;
      pendingCaretRef.current = head;
      const root = ref.current;
      if (root && document.activeElement !== root) root.focus({ preventScroll: true });
      // The line may be far off screen after a big undo.
      window.requestAnimationFrame(() =>
        revealLine(lineAtOffset(lineStartsRef.current, head)),
      );
    };
    window.addEventListener(DOCUMENT_SET_CARET_EVENT, handler);
    return () => window.removeEventListener(DOCUMENT_SET_CARET_EVENT, handler);
  }, []);

  useEffect(() => {
    const onSelectionChange = () => {
      if (document.activeElement !== ref.current) return;
      // The programmatic select-all fires one selectionchange of its own;
      // any later one is the person moving the selection somewhere real.
      if (skipSelectionClearRef.current) {
        skipSelectionClearRef.current = false;
      } else {
        allSelectedRef.current = false;
      }
      reportSelection();
    };
    const onPointerUp = () => {
      draggingRef.current = false;
    };
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerup", onPointerUp);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerup", onPointerUp);
    };
    // reportSelection reads refs only; the handler needs no re-binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSelection, ref]);

  const publish = () => {
    const root = ref.current;
    if (!root || composingRef.current) return;
    const at = selectionOffsets();
    if (at) rangeRef.current = at;
    // prefix + editable text + suffix is exactly the source. The spacers are
    // empty non-editable blocks, so root.textContent reads only materialized
    // rows: every child row is inline content whose newlines are literal
    // characters, and contentEditable="plaintext-only" admits no markup. In
    // whole-document mode prefix and suffix are empty.
    const windowText = root.textContent ?? "";
    const text = prefixRef.current + windowText + suffixRef.current;
    // Only the window's text can have changed natively; splice its lines into
    // the model instead of re-splitting the whole (possibly multi-megabyte)
    // value in reconcile.
    if (windowedRef.current && structureMatchesWrappers()) {
      const previous = linesRef.current;
      const win = winRef.current;
      const split = windowText.length === 0 ? [""] : windowText.split("\n");
      // Rows before the document's last line carry their trailing "\n", so a
      // window that does not reach the end splits with one empty tail entry.
      const windowLines = win.end < previous.length ? split.slice(0, -1) : split;
      const lines = previous.slice(0, win.start);
      for (const line of windowLines) lines.push(line);
      for (let i = win.end; i < previous.length; i += 1) {
        lines.push(previous[i]);
      }
      pendingModelRef.current = { value: text, lines };
    }
    domDirtyRef.current = true;
    onChange(text);
    // A native edit that changed DOM structure without changing the text (an
    // engine merging rows on its own initiative) produces no re-render, so
    // nothing would ever repair the rows. Renormalize on the spot.
    if (text === value && !structureMatchesWrappers()) {
      builtRef.current = null;
      reconcile();
    }
  };

  /**
   * The line the browser is editing natively is out of a controlled edit's
   * hands; everything STRUCTURAL is ours. Enter, deletes that cross a row
   * boundary, and multi-line insertions are applied as exact string edits
   * instead of letting the engine improvise block merges and splits it would
   * be expensive (and sometimes wrong) to reverse-engineer afterwards.
   */
  const replaceRange = (from: number, to: number, insert: string) => {
    const next = value.slice(0, from) + insert + value.slice(to);
    const caret = from + insert.length;
    pendingCaretRef.current = caret;
    rangeRef.current = { anchor: caret, head: caret };
    allSelectedRef.current = false;
    onChange(next);
  };

  const onBeforeInput = (native: InputEvent) => {
    if (composingRef.current || native.isComposing) return;
    const at = selectionOffsets();
    if (!at) return;
    const from = Math.min(at.anchor, at.head);
    const to = Math.max(at.anchor, at.head);
    const type = native.inputType;
    if (type === "historyUndo" || type === "historyRedo") {
      // The browser's own undo would rewrite DOM that React re-renders from
      // the source string a moment later, so it can only corrupt this
      // surface. Stop it; the Cmd+Z binding drives the CRDT's undo instead.
      native.preventDefault();
      return;
    }
    const spansRows = value.slice(from, to).includes("\n");
    if (type === "insertParagraph" || type === "insertLineBreak") {
      native.preventDefault();
      replaceRange(from, to, "\n");
      return;
    }
    if (
      type === "insertText" ||
      type === "insertFromPaste" ||
      type === "insertFromDrop" ||
      type === "insertReplacementText"
    ) {
      const data =
        native.data ??
        native.dataTransfer?.getData("text/plain") ??
        "";
      if (spansRows || data.includes("\n")) {
        native.preventDefault();
        replaceRange(from, to, data);
      }
      return;
    }
    if (type.startsWith("delete")) {
      if (spansRows) {
        native.preventDefault();
        replaceRange(from, to, "");
        return;
      }
      if (from === to) {
        const backward = type.includes("Backward") || type === "deleteContent";
        if (backward && from > 0 && value[from - 1] === "\n") {
          native.preventDefault();
          replaceRange(from - 1, from, "");
          return;
        }
        if (!backward && from < value.length && value[from] === "\n") {
          native.preventDefault();
          replaceRange(from, from + 1, "");
        }
      }
    }
  };

  /**
   * Copy serializes from the source string by offsets. Left to the browser, a
   * selection across block rows gains one invented newline per row on top of
   * the literal one it already contains, so pasted text doubled its blank
   * lines. In windowed mode this is also what makes select-all copy the whole
   * document rather than the materialized slice.
   */
  const copySelection = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const at = selectionOffsets();
    if (!at || at.anchor === at.head) return false;
    const from = Math.min(at.anchor, at.head);
    const to = Math.max(at.anchor, at.head);
    event.preventDefault();
    event.clipboardData.setData("text/plain", value.slice(from, to));
    return true;
  };

  /** One line's wrapper: styled segments, remote carets, trailing newline. */
  const buildWrapper = (
    line: string,
    lineStart: number,
    isLast: boolean,
    open = false,
  ): HTMLElement => {
    const wrapper = document.createElement("span");
    wrapper.setAttribute(LINE_ATTR, "");
    const lineEnd = lineStart + line.length + (isLast ? 0 : 1);
    const carets = selections
      .filter(
        (s) => s.from === s.to && s.from >= lineStart && s.from < lineEnd + 1,
      )
      .filter((s) => {
        // A caret exactly on the line boundary belongs to the NEXT line, so
        // one caret renders in one wrapper. The final line keeps end-of-text.
        if (isLast) return s.from <= lineEnd;
        return s.from < lineEnd;
      })
      .sort((left, right) => left.from - right.from);
    let caretIndex = 0;
    const emitCaretsUpTo = (limit: number) => {
      while (caretIndex < carets.length && carets[caretIndex].from <= limit) {
        const caret = carets[caretIndex];
        const mark = document.createElement("span");
        mark.className = "tt-remote-caret tt-md-remote-caret";
        mark.contentEditable = "false";
        mark.dataset.name = caret.userName;
        mark.style.setProperty("--tt-peer", caret.color);
        wrapper.appendChild(mark);
        caretIndex += 1;
      }
    };
    const pushText = (text: string, from: number, className?: string) => {
      if (!text) return;
      const to = from + text.length;
      const peer = selections.find((s) => s.from < to && s.to > from);
      let cls = peer ? `${className ?? ""} tt-md-peer`.trim() : className;
      // Built as the caret's own line: syntax markers start revealed, so a
      // fresh wrapper can compare equal to a live one revealLine has opened.
      if (open && cls && cls.includes(SYNTAX)) cls = `${cls} ${MARKER_OPEN}`;
      if (!cls) {
        // Plain runs are bare text nodes: at a large body the element count
        // is what the browser's editing and layout machinery pays for.
        wrapper.appendChild(document.createTextNode(text));
        return;
      }
      const span = document.createElement("span");
      span.className = cls;
      if (peer) span.style.setProperty("--tt-peer", peer.color);
      span.textContent = text;
      wrapper.appendChild(span);
    };

    let at = lineStart;
    const emitSegment = (text: string, className?: string) => {
      const segStart = at;
      const segEnd = at + text.length;
      emitCaretsUpTo(segStart);
      let cut = segStart;
      while (
        caretIndex < carets.length &&
        carets[caretIndex].from > segStart &&
        carets[caretIndex].from < segEnd
      ) {
        const boundary = carets[caretIndex].from;
        pushText(text.slice(cut - segStart, boundary - segStart), cut, className);
        emitCaretsUpTo(boundary);
        cut = boundary;
      }
      pushText(text.slice(cut - segStart), cut, className);
      at = segEnd;
    };
    for (const segment of segmentsForLine(line)) {
      emitSegment(segment.text, segment.className);
    }
    if (line.length === 0) {
      // A block row with only the zero-height newline collapses; the <br>
      // gives an empty line its height and a caret home. It adds nothing to
      // textContent.
      wrapper.appendChild(document.createElement("br"));
    }
    if (!isLast) {
      emitSegment("\n", "tt-md-nl");
    }
    emitCaretsUpTo(Number.POSITIVE_INFINITY);
    return wrapper;
  };

  // React's onBeforeInput prop is a legacy shim whose nativeEvent is not the
  // native InputEvent (no inputType), so structural interception must bind
  // the real event itself. The ref indirection keeps the listener stable
  // while the handler always sees the latest value.
  const beforeInputRef = useRef(onBeforeInput);
  useLayoutEffect(() => {
    beforeInputRef.current = onBeforeInput;
  });
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const handler = (event: Event) => beforeInputRef.current(event as InputEvent);
    root.addEventListener("beforeinput", handler);
    return () => root.removeEventListener("beforeinput", handler);
  }, [ref]);

  // React must NOT own these children. The browser inserts text nodes as the
  // writer types, React does not know about them, and reconciling against its
  // own virtual tree leaves both copies in the DOM: the text appears twice.
  // So the subtree is built imperatively, spliced by line, and only the
  // wrappers whose line actually changed are touched.
  //
  // What the DOM was last built from: the value by reference (a signature
  // string that embedded the value copied the whole body every render) and
  // the selections rendered into it.
  const selectionsSignature = selections
    .map((s) => `${s.clientId}:${s.from}:${s.to}:${s.color}:${s.userName}`)
    .join("|");
  const builtValueRef = useRef<string | null>(null);
  /** Native edits since the last reconcile; cleared once the DOM is trusted. */
  const domDirtyRef = useRef(false);

  const structureMatchesWrappers = (): boolean => {
    const root = ref.current;
    if (!root) return false;
    const wrappers = wrappersRef.current;
    const top =
      topSpacerRef.current && topSpacerRef.current.parentNode === root
        ? topSpacerRef.current
        : null;
    const bottom =
      bottomSpacerRef.current && bottomSpacerRef.current.parentNode === root
        ? bottomSpacerRef.current
        : null;
    const lead = top ? 1 : 0;
    const expected = wrappers.length + lead + (bottom ? 1 : 0);
    if (root.childNodes.length !== expected) return false;
    if (top && root.childNodes[0] !== top) return false;
    if (bottom && root.childNodes[expected - 1] !== bottom) return false;
    for (let i = 0; i < wrappers.length; i += 1) {
      if (root.childNodes[i + lead] !== wrappers[i]) return false;
    }
    return true;
  };

  const makeSpacer = (): HTMLElement => {
    const spacer = document.createElement("div");
    spacer.setAttribute(SPACER_ATTR, "");
    spacer.contentEditable = "false";
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.display = "block";
    spacer.style.pointerEvents = "none";
    return spacer;
  };

  /** How many lines fit the viewport, from the current row estimate. */
  const viewportLines = (): number => {
    const height =
      scrollerOf(ref.current ?? document.body)?.clientHeight ??
      window.innerHeight;
    return Math.max(10, Math.ceil(height / rowPxRef.current));
  };

  /**
   * Rebuild the editable children wholesale for the given window. O(window):
   * this is the fallback that keeps huge documents cheap, where the
   * whole-document rebuild was the expensive last resort before windowing.
   */
  const materializeWindow = (
    root: HTMLElement,
    lines: readonly string[],
    starts: readonly number[],
    desired: { start: number; end: number },
    windowed: boolean,
  ) => {
    const wrappers = wrappersRef.current;
    root.replaceChildren();
    wrappers.length = 0;
    openLineRef.current = null;
    const frag = document.createDocumentFragment();
    if (windowed) {
      const top = topSpacerRef.current ?? makeSpacer();
      topSpacerRef.current = top;
      top.style.height = `${Math.round(desired.start * rowPxRef.current)}px`;
      frag.appendChild(top);
    } else {
      topSpacerRef.current = null;
      bottomSpacerRef.current = null;
    }
    for (let i = desired.start; i < desired.end; i += 1) {
      const el = buildWrapper(lines[i], starts[i], i === lines.length - 1);
      wrappers.push(el);
      frag.appendChild(el);
    }
    if (windowed) {
      const bottom = bottomSpacerRef.current ?? makeSpacer();
      bottomSpacerRef.current = bottom;
      bottom.style.height = `${Math.round(
        (lines.length - desired.end) * rowPxRef.current,
      )}px`;
      frag.appendChild(bottom);
    }
    root.appendChild(frag);
    winRef.current = { ...desired };
    windowedRef.current = windowed;
    if (windowed) {
      prefixRef.current =
        desired.start > 0
          ? `${lines.slice(0, desired.start).join("\n")}\n`
          : "";
      suffixRef.current =
        desired.end < lines.length
          ? lines.slice(desired.end).join("\n")
          : "";
      // Refine the row estimate from what was just laid out, and re-set the
      // spacers with it so the scrollbar stays roughly honest.
      if (wrappers.length > 0) {
        const first = wrappers[0].getBoundingClientRect();
        const last = wrappers[wrappers.length - 1].getBoundingClientRect();
        const px = (last.bottom - first.top) / wrappers.length;
        if (px > 4 && Number.isFinite(px)) rowPxRef.current = px;
        topSpacerRef.current!.style.height = `${Math.round(
          desired.start * rowPxRef.current,
        )}px`;
        bottomSpacerRef.current!.style.height = `${Math.round(
          (lines.length - desired.end) * rowPxRef.current,
        )}px`;
      }
    } else {
      prefixRef.current = "";
      suffixRef.current = "";
    }
  };

  /**
   * Jump to a line, for the outline. The surface is windowed, so the target
   * usually has no DOM node yet: scroll the scroller to where the line sits
   * by row height first, and let the windowing materialize around it. A
   * second pass once it has re-windowed lands on the real row, which
   * corrects for the estimate the spacers were using.
   */
  const jumpToLine = (line: number) => {
    const root = ref.current;
    if (!root) return;
    const lines = linesRef.current;
    const target = Math.max(0, Math.min(line, Math.max(0, lines.length - 1)));
    const scroller = scrollerOf(root);
    const settle = (attempt: number) => {
      const win = winRef.current;
      const materialized =
        !windowedRef.current ||
        (target >= win.start && target < win.end);
      const el = materialized
        ? wrappersRef.current[windowedRef.current ? target - win.start : target]
        : null;
      if (el && scroller) {
        const top =
          scroller.scrollTop +
          el.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          JUMP_MARGIN_PX;
        scroller.scrollTo({ top: Math.max(0, top), behavior: "auto" });
      } else if (el) {
        el.scrollIntoView({ block: "start" });
      } else if (scroller) {
        const rootTop =
          scroller.scrollTop +
          root.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top;
        scroller.scrollTo({
          top: Math.max(0, rootTop + target * rowPxRef.current - JUMP_MARGIN_PX),
          behavior: "auto",
        });
      }
      if (attempt < 3) {
        window.requestAnimationFrame(() => {
          rewindowForViewport();
          window.requestAnimationFrame(() => settle(attempt + 1));
        });
      }
    };
    settle(0);
  };

  // Same idiom as the beforeinput binding: a ref so the window listener is
  // attached once while still calling the current closure.
  const jumpRef = useRef(jumpToLine);
  jumpRef.current = jumpToLine;
  useEffect(() => {
    const handler = (event: Event) => {
      const line = (event as CustomEvent<{ line?: number }>).detail?.line;
      if (typeof line === "number") jumpRef.current(line);
    };
    window.addEventListener(DOCUMENT_JUMP_EVENT, handler);
    return () => window.removeEventListener(DOCUMENT_JUMP_EVENT, handler);
  }, []);

  /**
   * Windowed scrolling: when the viewport leaves the materialized band,
   * re-materialize around it and pin the anchor row so the content under the
   * reader's eyes does not jump when the spacer estimates are corrected.
   */
  const rewindowForViewport = () => {
    const root = ref.current;
    if (!root || !windowedRef.current || composingRef.current) return;
    if (!structureMatchesWrappers()) return;
    const lines = linesRef.current;
    const win = winRef.current;
    const rootTop = root.getBoundingClientRect().top;
    const scroller = scrollerOf(root);
    const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
    const viewBottom = scroller
      ? viewTop + scroller.clientHeight
      : window.innerHeight;
    const px = rowPxRef.current;
    const firstVisible = Math.max(0, Math.floor((viewTop - rootTop) / px));
    const lastVisible = Math.min(
      lines.length,
      Math.ceil((viewBottom - rootTop) / px),
    );
    const margin = Math.floor(OVERSCAN_LINES / 2);
    const covered =
      (win.start === 0 || firstVisible - win.start >= margin) &&
      (win.end === lines.length || win.end - lastVisible >= margin);
    if (covered) return;

    const focused = document.activeElement === root;
    const keep = focused ? (selectionOffsets() ?? rangeRef.current) : null;
    const middle = Math.floor((firstVisible + lastVisible) / 2);
    const desired = windowAround(middle, lines.length, viewportLines());
    if (keep) {
      // The caret's line must stay materialized or the selection dies.
      const caretLine = lineAtOffset(
        lineStartsRef.current,
        Math.min(keep.head, valueRef.current.length),
      );
      desired.start = Math.min(desired.start, Math.max(0, caretLine - 2));
      desired.end = Math.max(desired.end, Math.min(lines.length, caretLine + 2));
    }
    // Anchor: the first visible materialized row and where it sits on screen.
    const anchorLine = Math.max(win.start, Math.min(firstVisible, win.end - 1));
    const anchorEl = wrappersRef.current[anchorLine - win.start];
    const anchorTop = anchorEl?.getBoundingClientRect().top ?? null;

    materializeWindow(root, lines, lineStartsRef.current, desired, true);

    if (
      anchorTop !== null &&
      anchorLine >= desired.start &&
      anchorLine < desired.end &&
      scroller
    ) {
      const fresh = wrappersRef.current[anchorLine - desired.start];
      if (fresh) {
        const delta = fresh.getBoundingClientRect().top - anchorTop;
        if (delta !== 0) scroller.scrollTop += delta;
      }
    }
    if (focused && keep) {
      const line = lineAtOffset(
        lineStartsRef.current,
        Math.min(keep.head, valueRef.current.length),
      );
      const place = (offset: number): { node: Node; offset: number } => {
        const l = lineAtOffset(lineStartsRef.current, offset);
        const wrapper = wrappersRef.current[l - desired.start];
        if (!wrapper) return { node: root, offset: 0 };
        return positionWithin(wrapper, offset - (lineStartsRef.current[l] ?? 0));
      };
      const selection = window.getSelection();
      if (selection && !allSelectedRef.current) {
        const from = place(Math.min(keep.anchor, valueRef.current.length));
        const to = place(Math.min(keep.head, valueRef.current.length));
        const range = document.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      revealLine(line);
    }
  };

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (!windowedRef.current || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        rewindowForViewport();
      });
    };
    // Scroll does not bubble, but the capture phase sees every scroller.
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // rewindowForViewport reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  const reconcile = () => {
    const root = ref.current;
    if (!root) return;
    if (composingRef.current) return;
    if (
      builtRef.current === selectionsSignature &&
      builtValueRef.current === value &&
      !domDirtyRef.current &&
      pendingCaretRef.current === null
    ) {
      return;
    }

    const focused = document.activeElement === root;
    let keep = focused ? (selectionOffsets() ?? rangeRef.current) : null;
    // A controlled structural edit already knows exactly where the caret
    // belongs; the DOM position it was captured from predates the edit.
    const pendingCaret = pendingCaretRef.current;
    pendingCaretRef.current = null;
    if (pendingCaret !== null && focused) {
      keep = { anchor: pendingCaret, head: pendingCaret };
    }

    const pendingModel = pendingModelRef.current;
    pendingModelRef.current = null;
    const nextLines =
      pendingModel && pendingModel.value === value
        ? pendingModel.lines
        : linesOf(value);
    const nextStarts = lineStartsOf(nextLines);
    const nextOverlays = lineOverlaySignatures(nextLines, nextStarts, selections);
    const windowed = value.length >= WINDOW_THRESHOLD;

    // The DOM is ours to splice only while it still has the exact wrapper
    // list the last reconcile left behind. Typing mutates text INSIDE a
    // wrapper, which is fine; anything that changed the top-level structure
    // (a paste the browser normalized oddly, a first keystroke into an empty
    // surface) falls back to materializing the window, which for a windowed
    // document is O(window) rather than O(document).
    const wrappers = wrappersRef.current;
    const structureTrusted = structureMatchesWrappers();
    const win = winRef.current;

    const previousLines = structureTrusted ? linesRef.current : [];
    const previousOverlays = structureTrusted ? overlaySigsRef.current : [];
    const splice = lineSplice(
      previousLines,
      nextLines,
      previousOverlays,
      nextOverlays,
    );

    const keepLine =
      keep !== null
        ? lineAtOffset(nextStarts, Math.min(keep.head, value.length))
        : null;
    // The window can stay put only when the change fits inside it and the
    // caret does not need lines it excludes.
    const windowStable =
      structureTrusted &&
      windowed === windowedRef.current &&
      (!windowed ||
        (splice.start >= win.start &&
          splice.oldEnd <= win.end &&
          (keepLine === null ||
            (keepLine >= win.start &&
              keepLine < win.end + (splice.newEnd - splice.oldEnd)))));

    if (!windowStable) {
      const desired = windowed
        ? windowAround(
            keepLine ?? Math.min(win.start, Math.max(0, nextLines.length - 1)),
            nextLines.length,
            viewportLines(),
          )
        : { start: 0, end: nextLines.length };
      materializeWindow(root, nextLines, nextStarts, desired, windowed);
      linesRef.current = nextLines;
      lineStartsRef.current = nextStarts;
      overlaySigsRef.current = nextOverlays;
      builtRef.current = selectionsSignature;
      builtValueRef.current = value;
      domDirtyRef.current = false;
      if (focused && keep && !draggingRef.current) {
        const clamp = (offset: number) =>
          Math.min(Math.max(offset, 0), value.length);
        const place = (offset: number): { node: Node; offset: number } => {
          const line = lineAtOffset(lineStartsRef.current, offset);
          const wrapper = wrappersRef.current[line - winRef.current.start];
          if (!wrapper) return { node: root, offset: 0 };
          return positionWithin(
            wrapper,
            offset - (lineStartsRef.current[line] ?? 0),
          );
        };
        const from = place(clamp(keep.anchor));
        const to = place(clamp(keep.head));
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.setStart(from.node, from.offset);
          range.setEnd(to.node, to.offset);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        rangeRef.current = { anchor: keep.anchor, head: keep.head };
        revealLine(keepLine);
      } else if (!focused) {
        revealLine(null);
      }
      return;
    }

    // The ordinary keystroke: the browser natively edited one line, and the
    // line still renders to the same DOM shape (same runs, same classes, the
    // text the browser already put there). Replacing the wrapper anyway and
    // re-planting the selection was the single largest per-keystroke cost at
    // large bodies: Selection.removeAllRanges/addRange on a huge editable is
    // where a third of the typing burst went in profile. If a fresh build is
    // node-for-node equal to what is live, keep the live one - the browser's
    // caret is already exactly right.
    if (
      pendingCaret === null &&
      splice.oldEnd - splice.start === 1 &&
      splice.newEnd - splice.start === 1
    ) {
      const line = splice.start;
      const fresh = buildWrapper(
        nextLines[line],
        nextStarts[line],
        line === nextLines.length - 1,
        openLineRef.current === line,
      );
      if (fresh.isEqualNode(wrappers[line - win.start])) {
        linesRef.current = nextLines;
        lineStartsRef.current = nextStarts;
        overlaySigsRef.current = nextOverlays;
        builtRef.current = selectionsSignature;
        builtValueRef.current = value;
        domDirtyRef.current = false;
        return;
      }
    }

    // Was the kept selection inside a wrapper this splice replaces? Offsets
    // are compared against the NEW line starts because that is where the
    // selection must land after the splice.
    const spliceStartOffset = nextStarts[splice.start] ?? value.length;
    const spliceEndOffset =
      splice.newEnd < nextLines.length
        ? nextStarts[splice.newEnd]
        : value.length;
    const keepNeedsRestore =
      keep !== null &&
      (pendingCaret !== null ||
        (Math.max(keep.anchor, keep.head) >= spliceStartOffset &&
          Math.min(keep.anchor, keep.head) <= spliceEndOffset));

    if (splice.start !== splice.oldEnd || splice.start !== splice.newEnd) {
      // A replaced wrapper may be the one revealLine opened; forget it so the
      // close pass never touches a detached element. An open line BELOW the
      // splice keeps its markers but changes index, so the bookkeeping moves
      // with it.
      if (openLineRef.current !== null) {
        if (
          openLineRef.current >= splice.start &&
          openLineRef.current < splice.oldEnd
        ) {
          openLineRef.current = null;
        } else if (openLineRef.current >= splice.oldEnd) {
          openLineRef.current += splice.newEnd - splice.oldEnd;
        }
      }
      const slotOf = (line: number) => line - win.start;
      const anchor =
        slotOf(splice.oldEnd) < wrappers.length
          ? wrappers[slotOf(splice.oldEnd)]
          : windowedRef.current
            ? bottomSpacerRef.current
            : null;
      const fresh: HTMLElement[] = [];
      for (let i = splice.start; i < splice.newEnd; i += 1) {
        fresh.push(
          buildWrapper(
            nextLines[i],
            nextStarts[i],
            i === nextLines.length - 1,
          ),
        );
      }
      for (let i = slotOf(splice.start); i < slotOf(splice.oldEnd); i += 1) {
        wrappers[i].remove();
      }
      if (fresh.length > 0) {
        const frag = document.createDocumentFragment();
        for (const el of fresh) frag.appendChild(el);
        root.insertBefore(frag, anchor);
      }
      wrappers.splice(
        slotOf(splice.start),
        splice.oldEnd - splice.start,
        ...fresh,
      );
      if (windowedRef.current) {
        // The window absorbed the line-count change; the lines beyond it are
        // untouched, so prefix, suffix and spacer heights all stand.
        winRef.current = {
          start: win.start,
          end: win.end + (splice.newEnd - splice.oldEnd),
        };
      }
    }

    linesRef.current = nextLines;
    lineStartsRef.current = nextStarts;
    overlaySigsRef.current = nextOverlays;
    builtRef.current = selectionsSignature;
    builtValueRef.current = value;
    domDirtyRef.current = false;

    // The invariant above everything: what the editable reads back must be
    // the window's slice of the value. If any browser edit left structure the
    // splice math missed, materialize the window from scratch rather than
    // ship a document that looks right and reads wrong. O(window) either way.
    const winNow = winRef.current;
    const expectedWindowText = windowedRef.current
      ? nextLines
          .slice(winNow.start, winNow.end)
          .map((line, i) =>
            winNow.start + i < nextLines.length - 1 ? `${line}\n` : line,
          )
          .join("")
      : value;
    if ((root.textContent ?? "") !== expectedWindowText) {
      materializeWindow(
        root,
        nextLines,
        nextStarts,
        windowedRef.current ? winNow : { start: 0, end: nextLines.length },
        windowedRef.current,
      );
    }

    if (focused && keep) {
      revealLine(
        lineAtOffset(nextStarts, Math.min(keep.head, value.length)),
      );
    } else if (!focused) {
      revealLine(null);
    }

    if (focused && keep && keepNeedsRestore && !draggingRef.current) {
      const clamp = (offset: number) =>
        Math.min(Math.max(offset, 0), value.length);
      const place = (offset: number): { node: Node; offset: number } => {
        const line = lineAtOffset(lineStartsRef.current, offset);
        const wrapper = wrappersRef.current[line - winRef.current.start];
        if (!wrapper) return { node: root, offset: 0 };
        return positionWithin(
          wrapper,
          offset - (lineStartsRef.current[line] ?? 0),
        );
      };
      const from = place(clamp(keep.anchor));
      const to = place(clamp(keep.head));
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      rangeRef.current = { anchor: keep.anchor, head: keep.head };
    }
  };

  useLayoutEffect(reconcile);

  return (
    <div
      ref={ref}
      className="tt-md-surface"
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      data-placeholder={placeholder}
      data-empty={value.length === 0 ? "true" : undefined}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={value.length < SPELLCHECK_LIMIT}
      onInput={publish}
      onCopy={(event) => {
        copySelection(event);
      }}
      onCut={(event) => {
        if (!copySelection(event)) return;
        const at = selectionOffsets();
        if (!at) return;
        replaceRange(Math.min(at.anchor, at.head), Math.max(at.anchor, at.head), "");
      }}
      onKeyDown={(event) => {
        if (!windowedRef.current) return;
        const meta = event.metaKey || event.ctrlKey;
        if (meta && (event.key === "a" || event.key === "A")) {
          // Native select-all can only reach materialized rows; the whole
          // document is the source string, so the selection is modeled there
          // and the DOM shows the window fully selected.
          event.preventDefault();
          allSelectedRef.current = true;
          skipSelectionClearRef.current = true;
          const selection = window.getSelection();
          const root = ref.current;
          if (selection && root) {
            const range = document.createRange();
            range.selectNodeContents(root);
            selection.removeAllRanges();
            selection.addRange(range);
          }
          rangeRef.current = { anchor: 0, head: value.length };
          onSelection(0, value.length);
          return;
        }
        if (meta && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          // Document start/end live outside the window; jump the window.
          event.preventDefault();
          pendingCaretRef.current =
            event.key === "ArrowDown" ? value.length : 0;
          reconcile();
          reportSelection();
        }
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        publish();
      }}
      onPointerDown={() => {
        draggingRef.current = true;
      }}
      onKeyUp={reportSelection}
      onMouseUp={reportSelection}
      onBlur={() => {
        revealLine(null);
        onSelection(-1, -1);
      }}
    />
  );
}
