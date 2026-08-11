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

import { useCallback, useEffect, useState } from "react";
import type { NativeQuickActionId } from "@/lib/ai/quick-actions";
import styles from "./SelectionActions.module.css";

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
  onRunAction,
}: {
  /** Editing an item. Elsewhere a selection is just reading. */
  enabled: boolean;
  onRunAction: (id: NativeQuickActionId) => void;
}) {
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);

  const refresh = useCallback(() => {
    if (!enabled) {
      setAnchor(null);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setAnchor(null);
      return;
    }
    if (!isActionableSelection(selection.toString())) {
      setAnchor(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setAnchor(null);
      return;
    }
    setAnchor(anchorFor(rect, { width: window.innerWidth }));
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setAnchor(null);
      return;
    }
    // selectionchange fires while dragging; settling on mouse/key release keeps
    // the toolbar from chasing the cursor across the paragraph.
    document.addEventListener("mouseup", refresh);
    document.addEventListener("keyup", refresh);
    document.addEventListener("selectionchange", refresh);
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    return () => {
      document.removeEventListener("mouseup", refresh);
      document.removeEventListener("keyup", refresh);
      document.removeEventListener("selectionchange", refresh);
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
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
