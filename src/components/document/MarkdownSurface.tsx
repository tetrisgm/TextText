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
// Three decisions are load-bearing and should survive any rewrite:
//
// 1. `textContent` is exactly the source. Every child is inline (per-line
//    inline wrappers holding inline segment spans), newlines are literal
//    characters, and remote-caret markers carry no text. One block element per
//    line would make `textContent` silently drop every newline and put remote
//    caret offsets out by one per line.
// 2. The local selection is restored ONLY when the nodes it lives in were
//    rebuilt. A peer's caret arriving re-renders this component about once a
//    second, and restoring on every render collapses whatever the writer had
//    selected, mid-drag.
// 3. Work per keystroke is proportional to the CHANGED LINES, never to the
//    buffer. The first version rebuilt the whole subtree on every input:
//    segmenting the entire body, allocating one span per segment (12,600
//    spans at a 100kB body, 129,000 at 1MB), replacing all children, and
//    relaying the whole document, which put visible input lag on any document
//    past a few tens of kilobytes. The reconciler now diffs by line and
//    splices only the wrappers whose line text or caret overlay changed, with
//    a full rebuild kept as the correctness net for any DOM state it does not
//    recognize.

import { useEffect, useLayoutEffect, useRef } from "react";

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
/**
 * Past this size the system spellchecker becomes an input-latency source of
 * its own on a contenteditable (isolating that took the fast-editor crowd
 * days; no reason to rediscover it). Notes keep their squiggles.
 */
const SPELLCHECK_LIMIT = 40_000;

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
): { start: number; oldEnd: number; newEnd: number } {
  let start = 0;
  const max = Math.min(previous.length, next.length);
  while (start < max && previous[start] === next[start]) start += 1;
  let oldEnd = previous.length;
  let newEnd = next.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    previous[oldEnd - 1] === next[newEnd - 1]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  return { start, oldEnd, newEnd };
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

  // The reconciled model: lines, their absolute starts, one wrapper element
  // per line in document order, and the overlay signature each wrapper was
  // built with. These stay in lockstep with the DOM between renders.
  const linesRef = useRef<string[]>([]);
  const lineStartsRef = useRef<number[]>([]);
  const wrappersRef = useRef<HTMLElement[]>([]);
  const overlaySigsRef = useRef<string[]>([]);
  const openLineRef = useRef<number | null>(null);
  const builtRef = useRef<string | null>(null);
  /** Where the caret must land after a controlled structural edit. */
  const pendingCaretRef = useRef<number | null>(null);

  /** The wrapper an event-target node lives in, or null for stray nodes. */
  const wrapperOf = (node: Node): { el: HTMLElement; index: number } | null => {
    let current: Node | null = node;
    const root = ref.current;
    while (current && current !== root) {
      if (
        current instanceof HTMLElement &&
        current.hasAttribute(LINE_ATTR) &&
        current.parentNode === root
      ) {
        const index = wrappersRef.current.indexOf(current);
        return index >= 0 ? { el: current, index } : null;
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
        return total;
      }
      const wrapper = wrapperOf(node);
      if (wrapper) {
        return (
          (lineStartsRef.current[wrapper.index] ?? 0) +
          offsetWithin(wrapper.el, node, nodeOffset)
        );
      }
      return offsetWithin(root, node, nodeOffset);
    };
    return {
      anchor: at(range.startContainer, range.startOffset),
      head: at(range.endContainer, range.endOffset),
    };
  };

  /**
   * Show the syntax of the line the caret is on, and only that line. Scoped
   * to the two affected wrappers; the markers stay in the DOM either way, so
   * `textContent` and every absolute offset are unmoved.
   */
  const revealLine = (line: number | null) => {
    const wrappers = wrappersRef.current;
    const previous = openLineRef.current;
    if (previous === line) return;
    if (previous !== null) {
      const el = wrappers[previous];
      if (el?.isConnected) {
        for (const marker of el.querySelectorAll<HTMLElement>(`.${SYNTAX}`)) {
          marker.classList.remove(MARKER_OPEN);
        }
      }
    }
    if (line !== null) {
      const el = wrappers[line];
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
    revealLine(lineAtOffset(lineStartsRef.current, at.head));
    onSelection(at.anchor, at.head);
  };

  useEffect(() => {
    const onSelectionChange = () => {
      if (document.activeElement !== ref.current) return;
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
    // textContent is exactly the source: every child is a line row of inline
    // content, newlines are literal characters (zero-height, but present),
    // and contentEditable="plaintext-only" admits no pasted markup.
    const text = root.textContent ?? "";
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
    onChange(next);
  };

  const onBeforeInput = (native: InputEvent) => {
    if (composingRef.current || native.isComposing) return;
    const at = selectionOffsets();
    if (!at) return;
    const from = Math.min(at.anchor, at.head);
    const to = Math.max(at.anchor, at.head);
    const type = native.inputType;
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
   * lines.
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
      const cls = peer ? `${className ?? ""} tt-md-peer`.trim() : className;
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
  const signature = `${value} ${selections
    .map((s) => `${s.clientId}:${s.from}:${s.to}:${s.color}:${s.userName}`)
    .join("|")}`;

  const structureMatchesWrappers = (): boolean => {
    const root = ref.current;
    if (!root) return false;
    const wrappers = wrappersRef.current;
    if (root.childNodes.length !== wrappers.length) return false;
    for (let i = 0; i < wrappers.length; i += 1) {
      if (root.childNodes[i] !== wrappers[i]) return false;
    }
    return true;
  };

  const reconcile = () => {
    const root = ref.current;
    if (!root) return;
    if (composingRef.current) return;
    if (builtRef.current === signature && root.textContent === value) return;

    const focused = document.activeElement === root;
    let keep = focused ? (selectionOffsets() ?? rangeRef.current) : null;
    // A controlled structural edit already knows exactly where the caret
    // belongs; the DOM position it was captured from predates the edit.
    const pendingCaret = pendingCaretRef.current;
    pendingCaretRef.current = null;
    if (pendingCaret !== null && focused) {
      keep = { anchor: pendingCaret, head: pendingCaret };
    }

    const nextLines = linesOf(value);
    const nextStarts = lineStartsOf(nextLines);
    const nextOverlays = lineOverlaySignatures(nextLines, nextStarts, selections);

    // The DOM is ours to splice only while it still has the exact wrapper
    // list the last reconcile left behind. Typing mutates text INSIDE a
    // wrapper, which is fine; anything that changed the top-level structure
    // (a paste the browser normalized oddly, a first keystroke into an empty
    // surface) falls back to building everything, which is the old behavior
    // and always correct.
    const wrappers = wrappersRef.current;
    const structureTrusted = structureMatchesWrappers();

    const previousLines = structureTrusted ? linesRef.current : [];
    const previousOverlays = structureTrusted ? overlaySigsRef.current : [];
    const keyed = (lines: readonly string[], overlays: readonly string[]) =>
      lines.map((line, i) => `${line}${overlays[i] ?? ""}`);
    const splice = lineSplice(
      keyed(previousLines, previousOverlays),
      keyed(nextLines, nextOverlays),
    );
    if (!structureTrusted) {
      // Rebuild everything: splice the full range over a cleared root.
      root.replaceChildren();
      wrappers.length = 0;
      splice.start = 0;
      splice.oldEnd = 0;
      splice.newEnd = nextLines.length;
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
        !structureTrusted ||
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
      const anchor =
        splice.oldEnd < wrappers.length ? wrappers[splice.oldEnd] : null;
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
      for (let i = splice.start; i < splice.oldEnd; i += 1) {
        wrappers[i].remove();
      }
      if (fresh.length > 0) {
        const frag = document.createDocumentFragment();
        for (const el of fresh) frag.appendChild(el);
        root.insertBefore(frag, anchor);
      }
      wrappers.splice(splice.start, splice.oldEnd - splice.start, ...fresh);
    }

    linesRef.current = nextLines;
    lineStartsRef.current = nextStarts;
    overlaySigsRef.current = nextOverlays;
    builtRef.current = signature;

    // The invariant above everything: what the DOM reads back must be the
    // value. If any browser edit left structure the splice math missed, build
    // the whole surface from scratch rather than ship a document that looks
    // right and reads wrong.
    if (root.textContent !== value) {
      root.replaceChildren();
      wrappers.length = 0;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < nextLines.length; i += 1) {
        const el = buildWrapper(
          nextLines[i],
          nextStarts[i],
          i === nextLines.length - 1,
        );
        wrappers.push(el);
        frag.appendChild(el);
      }
      root.appendChild(frag);
      openLineRef.current = null;
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
        const wrapper = wrappersRef.current[line];
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
