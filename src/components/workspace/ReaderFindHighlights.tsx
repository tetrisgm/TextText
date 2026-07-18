"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ReaderFindHighlights.module.css";

type Match = { start: number; end: number };
type TextSegment = {
  end: number;
  node: Text;
  start: number;
};
type HighlightRect = {
  height: number;
  key: string;
  left: number;
  top: number;
  width: number;
};

export function findReaderTextMatches(text: string, query: string): Match[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const haystack = text.toLocaleLowerCase();
  const matches: Match[] = [];
  let offset = 0;
  while (offset < haystack.length) {
    const start = haystack.indexOf(needle, offset);
    if (start < 0) break;
    matches.push({ start, end: start + needle.length });
    offset = start + Math.max(needle.length, 1);
  }
  return matches;
}

function readerText(root: HTMLElement): {
  segments: TextSegment[];
  text: string;
} {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!node.textContent || !parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("button, input, textarea, [aria-hidden='true']")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const segments: TextSegment[] = [];
  let text = "";
  let node = walker.nextNode();
  while (node) {
    const value = node.textContent ?? "";
    const start = text.length;
    text += value;
    segments.push({ node: node as Text, start, end: text.length });
    node = walker.nextNode();
  }
  return { segments, text };
}

function segmentAt(segments: TextSegment[], offset: number) {
  return segments.find(
    (segment) => offset >= segment.start && offset <= segment.end,
  );
}

function rangesForMatches(
  segments: TextSegment[],
  matches: Match[],
): Range[] {
  return matches.flatMap((match) => {
    const startSegment = segmentAt(segments, match.start);
    const endSegment = segmentAt(segments, match.end);
    if (!startSegment || !endSegment) return [];
    const range = document.createRange();
    range.setStart(startSegment.node, match.start - startSegment.start);
    range.setEnd(endSegment.node, match.end - endSegment.start);
    return [range];
  });
}

export function ReaderFindHighlights({ query }: { query: string }) {
  const markerRef = useRef<HTMLDivElement>(null);
  const lastScrolledQueryRef = useRef("");
  const [rects, setRects] = useState<HighlightRect[]>([]);

  useEffect(() => {
    const surface = markerRef.current?.parentElement;
    const prose = surface?.querySelector<HTMLElement>(".reader-prose");
    if (!prose || !query.trim()) {
      setRects([]);
      lastScrolledQueryRef.current = "";
      return;
    }

    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const { segments, text } = readerText(prose);
        const ranges = rangesForMatches(
          segments,
          findReaderTextMatches(text, query),
        );
        const nextRects = ranges.flatMap((range, rangeIndex) =>
          Array.from(range.getClientRects())
            .filter((rect) => rect.width > 0 && rect.height > 0)
            .map((rect, rectIndex) => ({
              key: `${rangeIndex}:${rectIndex}`,
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            })),
        );
        setRects(nextRects);

        const normalizedQuery = query.trim().toLocaleLowerCase();
        if (
          ranges[0] &&
          normalizedQuery !== lastScrolledQueryRef.current
        ) {
          lastScrolledQueryRef.current = normalizedQuery;
          ranges[0].startContainer.parentElement?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "auto"
              : "smooth",
            block: "center",
          });
        }
      });
    };

    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(prose);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [query]);

  return (
    <div ref={markerRef} className={styles.layer} aria-hidden="true">
      {rects.map((rect) => (
        <span
          key={rect.key}
          className={styles.highlight}
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
    </div>
  );
}
