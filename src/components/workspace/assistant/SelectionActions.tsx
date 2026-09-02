"use client";

// AI where the writing is.
//
// The rail is a place you go; this is the thing that finds you. Selecting text
// and being offered "rewrite this" is what makes an assistant feel like part of
// the editor rather than a chat window parked beside it.
//
// It deliberately owns no AI logic. The actions are the same quick actions the
// rail runs, against the same selection the rail already reads, and the result
// arrives as a proposal you accept or undo. Nothing here applies model output
// to a document.

import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeQuickActionId } from "@/lib/ai/quick-actions";
import styles from "./SelectionActions.module.css";

type EditorTextSelection = { text: string };

/** Only the actions that mean something about a passage of text. */
export const SELECTION_ACTIONS: ReadonlyArray<{
  id: NativeQuickActionId;
  label: string;
  title: string;
}> = [
  { id: "rewrite", label: "Rewrite", title: "Preview a rewrite of the selection" },
  { id: "summarize", label: "Summarize", title: "Summarize the selection" },
  { id: "excerpt", label: "Excerpt", title: "Draft an excerpt from the selection" },
];

export type SelectionAnchor = { left: number; top: number };

/**
 * Where the toolbar sits, given the selection's rectangle and the viewport.
 *
 * Pure because the interesting cases are the edges: a selection at the very top
 * of the window would put the toolbar off-screen, and one at the right edge
 * would push it out of view. Both are easy to get wrong and impossible to
 * notice until somebody selects text in the wrong place.
 */
export function anchorFor(
  rect: { left: number; right: number; top: number; width: number },
  viewport: { width: number },
  toolbar = { width: 220, height: 40, gap: 8 },
): SelectionAnchor {
  const centred = rect.left + rect.width / 2 - toolbar.width / 2;
  const maxLeft = Math.max(toolbar.gap, viewport.width - toolbar.width - toolbar.gap);
  const left = Math.min(Math.max(toolbar.gap, centred), maxLeft);
  // Above the selection, unless there is no room, in which case below it so it
  // never sits off the top of the window.
  const above = rect.top - toolbar.height - toolbar.gap;
  const top = above >= toolbar.gap ? above : rect.top + toolbar.height;
  return { left, top };
}

/** A selection worth offering to act on: real text, not a stray click. */
export function isActionableSelection(text: string | null | undefined): boolean {
  return (text ?? "").trim().length >= 2;
}

export function SelectionActions({
  enabled,
  readSelection,
  onRunAction,
}: {
  /** Editing an item. Elsewhere a selection is just reading. */
  enabled: boolean;
  /**
   * The editor's own account of what is selected. The body of an item is a
   * textarea, and window.getSelection() does not see textarea selections at
   * all, so the first version of this toolbar could never appear where it
   * mattered. The editor already reports its selection for the assistant
   * context; that one source feeds this too.
   */
  readSelection: () => EditorTextSelection | null;
  onRunAction: (id: NativeQuickActionId) => void;
}) {
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);
  const anchorRef = useRef<SelectionAnchor | null>(null);
  anchorRef.current = anchor;
  // Where the pointer last let go: the anchor a textarea cannot give us.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const refresh = useCallback(() => {
    if (!enabled) {
      setAnchor(null);
      return;
    }
    const selection = readSelection();
    if (!selection || !isActionableSelection(selection.text)) {
      setAnchor(null);
      return;
    }
    const at = pointerRef.current;
    const rect = at
      ? { left: at.x, right: at.x, top: at.y, width: 0 }
      : (() => {
          const field = document.activeElement;
          if (!(field instanceof HTMLElement)) return null;
          const b = field.getBoundingClientRect();
          return { left: b.left + b.width / 2, right: b.left + b.width / 2, top: b.top + 48, width: 0 };
        })();
    if (!rect) {
      setAnchor(null);
      return;
    }
    setAnchor(anchorFor(rect, { width: window.innerWidth }));
  }, [enabled, readSelection]);

  useEffect(() => {
    if (!enabled) {
      const clear = window.setTimeout(() => setAnchor(null), 0);
      return () => window.clearTimeout(clear);
    }
    // Settling on mouse/key release keeps the toolbar from chasing the cursor
    // across the paragraph mid-drag.
    // A short settle beats event-order archaeology: a double-click's word
    // selection, a drag release, and shift-arrow growth all finish writing to
    // the draft store within a frame or two of their last event.
    let settle: number | undefined;
    const scheduleRefresh = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(refresh, 60);
    };
    const onMouseUp = (event: MouseEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      scheduleRefresh();
    };
    const onKeyUp = () => {
      pointerRef.current = null;
      scheduleRefresh();
    };
    // selectionchange fires for textarea selections too, which covers the
    // paths that have no convenient final event of their own.
    const onSelectionChange = () => scheduleRefresh();
    // Guarded: this rides capture-phase scroll from EVERY scroller; a
    // setState per scroll event (even a bail-out one) is scheduler noise.
    const dismiss = () => {
      if (anchorRef.current) setAnchor(null);
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.clearTimeout(settle);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [enabled, refresh]);

  if (!anchor) return null;

  return (
    <div
      className={styles.bar}
      style={{ left: anchor.left, top: anchor.top }}
      role="toolbar"
      aria-label="AI actions for the selected text"
      // Taking focus would collapse the selection the actions are about.
      onMouseDown={(event) => event.preventDefault()}
    >
      {SELECTION_ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          className={styles.action}
          title={action.title}
          onClick={() => {
            setAnchor(null);
            onRunAction(action.id);
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
