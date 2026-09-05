"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { captureInlineSelectionSurface, type InlineSelectionSurface } from "@/components/document/inline-selection-surface";
import { readOpenWorkspaceItemDraft, subscribeOpenWorkspaceItemDrafts, type WorkspaceItemTextSelection } from "@/lib/ai/workspace-item-draft";
import { INLINE_ACTIONS, type InlinePreviewController, type InlineStatus } from "./inline-preview";
import styles from "./InlineSelectionPreview.module.css";

export const INLINE_STATUS_LABELS: Record<InlineStatus, string> = {
  generating: "Generating", ready: "Ready", applying: "Applying", applied: "Applied",
  stale: "The passage changed", failed: "Failed", discarded: "Discarded", undone: "Undone",
};
export function previewKeyAction(key: string, meta: boolean, composing: boolean, status: InlineStatus) {
  if (composing) return null;
  if (key === "Escape" && status !== "applying" && status !== "applied") return "discard";
  return key === "Enter" && meta && status === "ready" ? "accept" : null;
}

export function InlineSelectionPreview({ controller, surface, readSelection, onClose }: {
  controller: InlinePreviewController;
  surface: InlineSelectionSurface;
  readSelection: () => WorkspaceItemTextSelection | null;
  onClose: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const ref = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef(surface);
  const changing = state.status === "applying";
  const discard = () => {
    if (!controller.discard()) return;
    onClose();
    surfaceRef.current.restore();
  };

  useEffect(() => {
    controller.start();
    ref.current?.focus({ preventScroll: true });
    return () => controller.dispose();
  }, [controller]);

  useLayoutEffect(() => {
    const preview = ref.current;
    if (!preview) return;
    // Regenerate may bind a newly selected range, so positioning and Escape
    // follow the acknowledged envelope instead of the first toolbar click.
    const anchoredSurface = state.envelope
      ? captureInlineSelectionSurface(state.itemId, state.envelope) ?? surface
      : surface;
    surfaceRef.current = anchoredSurface;
    let passage: HTMLElement | null = null;
    let previousMargin = "";
    let frame = 0;
    const release = () => { if (passage) passage.style.marginBottom = previousMargin; };
    const position = () => {
      frame = 0;
      const next = anchoredSurface.passage();
      if (next !== passage) {
        release();
        passage = next;
        previousMargin = passage?.style.marginBottom ?? "";
      }
      if (!passage?.isConnected) { preview.style.visibility = "hidden"; return; }
      const column = anchoredSurface.column.getBoundingClientRect();
      preview.style.width = `${Math.max(0, Math.min(560, column.width - 16))}px`;
      preview.style.left = `${column.left + 8}px`;
      // Space belongs to an existing source row. The preview is outside the
      // contenteditable, so textContent, offsets, copy and Yjs stay exact.
      passage.style.marginBottom = `${preview.offsetHeight + 16}px`;
      const top = passage.getBoundingClientRect().bottom + 8;
      preview.style.top = `${top}px`;
      const clip = anchoredSurface.column.closest(".post-editor-content")?.getBoundingClientRect();
      const minY = Math.max(0, clip?.top ?? 0);
      const maxY = Math.min(window.innerHeight, clip?.bottom ?? window.innerHeight);
      const cutTop = Math.max(0, minY - top);
      const cutBottom = Math.max(0, top + preview.offsetHeight - maxY);
      preview.style.clipPath = cutTop || cutBottom ? `inset(${cutTop}px 0 ${cutBottom}px 0)` : "none";
      preview.style.visibility = "visible";
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(position); };
    const check = () => {
      controller.check(readOpenWorkspaceItemDraft(state.itemId));
      schedule();
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(preview);
    resize.observe(anchoredSurface.column);
    const mutation = new MutationObserver(check);
    mutation.observe(anchoredSurface.column, { childList: true, subtree: true, characterData: true });
    const unsubscribe = subscribeOpenWorkspaceItemDrafts(check);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    position();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect(); mutation.disconnect(); unsubscribe();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      release();
    };
  }, [controller, state.itemId, state.envelope, surface]);

  return (
    <div ref={ref} tabIndex={0} role="region" aria-label="Selection preview"
      className={`${styles.palette} ${styles.preview}`} data-state={state.status}
      onKeyDown={(event) => {
        // Local handler only: document Cmd+Enter must never accept a preview.
        const action = previewKeyAction(event.key, event.metaKey, event.nativeEvent.isComposing, state.status);
        if (!action) return;
        event.preventDefault(); event.stopPropagation();
        if (action === "accept") void controller.accept();
        else discard();
      }}>
      <div className={styles.header}>
        {INLINE_ACTIONS.find((action) => action.id === state.action)?.label} · {state.title} · {state.words} selected {state.words === 1 ? "word" : "words"}
      </div>
      <div className={styles.body} aria-live="off">{state.text}</div>
      <div className={styles.status} role="status" aria-live="polite" aria-atomic="true">{INLINE_STATUS_LABELS[state.status]}</div>
      {state.error && <div className={styles.error}>{state.error}</div>}
      <div className={styles.actions}>
        {state.status === "generating" && <button type="button" onClick={() => controller.stop()}>Stop</button>}
        {(state.status === "ready" || changing) && <button type="button" disabled={changing} onClick={() => void controller.accept()}>
          {changing ? "Applying" : state.action === "summarize" ? "Insert below" : "Accept"}
        </button>}
        {state.status === "applied" && <button type="button" disabled={state.uncertain} onClick={() => void controller.undo()}>Undo</button>}
        {(state.status === "ready" || state.status === "failed" || state.status === "stale" || changing) &&
          <button type="button" disabled={changing} onClick={discard}>Discard</button>}
        {state.status === "ready" && state.action === "summarize" &&
          <button type="button" onClick={() => void controller.accept(true)}>Replace selection</button>}
        {(state.status === "stale" || (state.status === "failed" && !state.uncertain)) &&
          <button type="button" onClick={() => controller.retry(readSelection())}>{state.status === "stale" ? "Regenerate" : "Retry"}</button>}
        {(state.status === "applied" || state.status === "undone") && <button type="button" onClick={onClose}>Close</button>}
      </div>
    </div>
  );
}
