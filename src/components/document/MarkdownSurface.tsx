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
// Two decisions are load-bearing and should survive any rewrite:
//
// 1. The whole body is ONE `white-space: pre-wrap` element whose children are
//    inline spans, with newlines as literal characters. `textContent` is then
//    exactly the source. One block element per line makes `textContent`
//    silently drop every newline and puts remote-caret offsets out by one per
//    line.
// 2. The local selection is restored ONLY when the text changed. A peer's
//    caret arriving re-renders this component about once a second, and
//    restoring on every render collapses whatever the writer had selected,
//    mid-drag. Segments are keyed by source offset so an unchanged text
//    reconciles without touching the nodes the selection lives in.

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export type SurfaceSelection = {
  clientId: number;
  userName: string;
  color: string;
  from: number;
  to: number;
};

type Segment = { text: string; className?: string };

const MARKER = "tt-md-marker";

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
        className: `${MARKER} ${cls}`,
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
    if (match[1]) {
      out.push({ text: match[1], className: MARKER });
      out.push({ text: match[2], className: "tt-md-strong" });
      out.push({ text: match[1], className: MARKER });
    } else if (match[3]) {
      out.push({ text: match[3], className: MARKER });
      out.push({ text: match[4], className: "tt-md-em" });
      out.push({ text: match[3], className: MARKER });
    } else {
      out.push({ text: match[5], className: MARKER });
      out.push({ text: match[6], className: "tt-md-code" });
      out.push({ text: match[7], className: MARKER });
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Every segment of the whole body, newlines included as literal text. */
function segmentsForValue(value: string): Segment[] {
  const out: Segment[] = [];
  const lines = value.split("\n");
  lines.forEach((line, index) => {
    out.push(...segmentsForLine(line));
    if (index < lines.length - 1) out.push({ text: "\n" });
  });
  return out;
}

/** Absolute character offset of a DOM position inside the surface. */
function offsetOf(root: HTMLElement, node: Node, nodeOffset: number): number {
  if (node === root) {
    let total = 0;
    for (let i = 0; i < nodeOffset && i < root.childNodes.length; i += 1) {
      total += root.childNodes[i].textContent?.length ?? 0;
    }
    return total;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === node) return total + nodeOffset;
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return total;
}

/** The DOM position for an absolute character offset. */
function positionAt(
  root: HTMLElement,
  offset: number,
): { node: Node; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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
    : { node: root, offset: 0 };
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
  const renderedValueRef = useRef<string | null>(null);

  const readSelection = useCallback(() => {
    const root = ref.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;
    return {
      anchor: offsetOf(root, range.startContainer, range.startOffset),
      head: offsetOf(root, range.endContainer, range.endOffset),
    };
  }, [ref]);

  const reportSelection = useCallback(() => {
    const at = readSelection();
    if (!at) return;
    rangeRef.current = at;
    onSelection(at.anchor, at.head);
  }, [onSelection, readSelection]);

  useEffect(() => {
    const onSelectionChange = () => {
      if (document.activeElement === ref.current) reportSelection();
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
  }, [ref, reportSelection]);

  const publish = useCallback(() => {
    const root = ref.current;
    if (!root || composingRef.current) return;
    const at = readSelection();
    if (at) rangeRef.current = at;
    // textContent is exactly the source, because every child is inline and
    // newlines are literal characters. contentEditable="plaintext-only" keeps
    // it that way: no pasted markup, no browser-invented elements.
    onChange(root.textContent ?? "");
  }, [onChange, readSelection, ref]);

  // React must NOT own these children. The browser inserts text nodes as the
  // writer types, React does not know about them, and reconciling against its
  // own virtual tree leaves both copies in the DOM: the text appears twice.
  // So the subtree is built imperatively, and only when it actually needs to
  // change, with the local selection preserved across the rebuild.
  const signature = `${value}\u0000${selections
    .map((s) => `${s.clientId}:${s.from}:${s.to}:${s.color}:${s.userName}`)
    .join("|")}`;
  const builtRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (composingRef.current) return;
    if (builtRef.current === signature && root.textContent === value) return;

    const focused = document.activeElement === root;
    const keep = focused ? (readSelection() ?? rangeRef.current) : null;

    const carets = selections
      .filter((selection) => selection.from === selection.to)
      .sort((left, right) => left.from - right.from);
    const frag = document.createDocumentFragment();
    let caretIndex = 0;
    const emitCaretsUpTo = (limit: number) => {
      while (caretIndex < carets.length && carets[caretIndex].from <= limit) {
        const caret = carets[caretIndex];
        const mark = document.createElement("span");
        mark.className = "tt-remote-caret tt-md-remote-caret";
        mark.contentEditable = "false";
        mark.dataset.name = caret.userName;
        mark.style.setProperty("--tt-peer", caret.color);
        frag.appendChild(mark);
        caretIndex += 1;
      }
    };
    const pushText = (text: string, from: number, className?: string) => {
      if (!text) return;
      const to = from + text.length;
      const peer = selections.find((s) => s.from < to && s.to > from);
      const span = document.createElement("span");
      const cls = peer ? `${className ?? ""} tt-md-peer`.trim() : className;
      if (cls) span.className = cls;
      if (peer) span.style.setProperty("--tt-peer", peer.color);
      span.textContent = text;
      frag.appendChild(span);
    };

    let at = 0;
    for (const segment of segmentsForValue(value)) {
      const segStart = at;
      const segEnd = at + segment.text.length;
      emitCaretsUpTo(segStart);
      let cut = segStart;
      while (
        caretIndex < carets.length &&
        carets[caretIndex].from > segStart &&
        carets[caretIndex].from < segEnd
      ) {
        const boundary = carets[caretIndex].from;
        pushText(
          segment.text.slice(cut - segStart, boundary - segStart),
          cut,
          segment.className,
        );
        emitCaretsUpTo(boundary);
        cut = boundary;
      }
      pushText(segment.text.slice(cut - segStart), cut, segment.className);
      at = segEnd;
    }
    emitCaretsUpTo(Number.POSITIVE_INFINITY);

    root.replaceChildren(frag);
    builtRef.current = signature;
    renderedValueRef.current = value;

    if (focused && keep && !draggingRef.current) {
      const length = root.textContent?.length ?? 0;
      const from = positionAt(root, Math.min(keep.anchor, length));
      const to = positionAt(root, Math.min(keep.head, length));
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  });

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
      spellCheck
      onInput={publish}
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
      onBlur={() => onSelection(-1, -1)}
    />
  );
}
