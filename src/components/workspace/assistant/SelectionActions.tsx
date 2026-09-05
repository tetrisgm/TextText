"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceItemTextSelection } from "@/lib/ai/workspace-item-draft";
import { captureInlineSelectionSurface, type InlineSelectionSurface } from "@/components/document/inline-selection-surface";
import { INLINE_ACTIONS, type InlineAction, type InlineRequest, type InlinePreviewController } from "./inline-preview";
import { InlineSelectionPreview } from "./InlineSelectionPreview";
import {
  MAX_SELECTION_CHARS,
  SELECTION_BUDGET_ERROR,
  SELECTION_INVALID_ERROR,
} from "@/lib/ai/selection-envelope";
import { SELECTION_PREVIEW_EVENT, type SelectionPreviewEventDetail } from "./selection-preview-event";
import { SELECTION_ERROR_EVENT } from "./selection-error";
import styles from "./SelectionActions.module.css";
import previewStyles from "./InlineSelectionPreview.module.css";

export const SELECTION_ACTIONS = INLINE_ACTIONS;

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
  itemId,
  readSelection,
  onRunAction,
}: {
  /** Editing an item. Elsewhere a selection is just reading. */
  enabled: boolean;
  itemId?: string;
  /**
   * The editor's own account of what is selected. The body of an item is a
   * textarea, and window.getSelection() does not see textarea selections at
   * all, so the first version of this toolbar could never appear where it
   * mattered. The editor already reports its selection for the assistant
   * context; that one source feeds this too.
   */
  readSelection: () => WorkspaceItemTextSelection | null;
  onRunAction: (request: InlineRequest) => Promise<InlinePreviewController | null>;
}) {
  const [preview, setPreview] = useState<{ controller: InlinePreviewController; surface: InlineSelectionSurface } | null>(null);
  const [translating, setTranslating] = useState(false);
  const [language, setLanguage] = useState("English");
  const frozenRef = useRef<WorkspaceItemTextSelection | null>(null);
  const aliveRef = useRef(true);
  const launchingRef = useRef(false);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  const barRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);
  const anchorRef = useRef<SelectionAnchor | null>(null);
  // Mirrored after commit for the handlers; a render must not write a ref.
  useEffect(() => { anchorRef.current = anchor; }, [anchor]);
  // Where the pointer last let go: the anchor a textarea cannot give us.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const selectedTextRef = useRef<string | null>(null);
  const refresh = useCallback(() => {
    if (!enabled) {
      setError(null);
      setAnchor(null);
      return;
    }
    if (preview || barRef.current?.contains(document.activeElement)) return;
    const selection = readSelection();
    if (!selection || !isActionableSelection(selection.text)) {
      setError(null);
      setAnchor(null);
      return;
    }
    frozenRef.current = { ...selection };
    if (selectedTextRef.current !== selection.text) setError(null);
    selectedTextRef.current = selection.text;
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
    setAnchor(anchorFor(rect, { width: window.innerWidth }, { width: 560, height: 40, gap: 8 }));
  }, [enabled, readSelection, preview]);

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
      if (barRef.current?.contains(event.target as Node)) return;
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

  useEffect(() => {
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ itemId: string; message: string }>).detail;
      if (!enabled || detail?.itemId !== itemId) return;
      refresh();
      setError(detail.message);
    };
    window.addEventListener(SELECTION_ERROR_EVENT, onError);
    return () => window.removeEventListener(SELECTION_ERROR_EVENT, onError);
  }, [enabled, itemId, refresh]);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<SelectionPreviewEventDetail>).detail;
      if (!enabled || !detail || detail.itemId !== itemId || preview?.controller.snapshot().status === "applying") return;
      preview?.controller.discard();
      setPreview({ controller: detail.controller, surface: detail.surface });
      detail.accepted = true;
    };
    window.addEventListener(SELECTION_PREVIEW_EVENT, receive);
    return () => window.removeEventListener(SELECTION_PREVIEW_EVENT, receive);
  }, [enabled, itemId, preview]);

  const run = async (action: InlineAction) => {
    if (launchingRef.current || !itemId) return;
    const selection = readSelection() ?? frozenRef.current;
    if (!selection || !isActionableSelection(selection.text)) { setError(SELECTION_INVALID_ERROR); return; }
    if (selection.text.length > MAX_SELECTION_CHARS) { setError(SELECTION_BUDGET_ERROR); return; }
    frozenRef.current = { ...selection };
    if (action === "translate" && !translating) { setTranslating(true); return; }
    const surface = captureInlineSelectionSurface(itemId, selection);
    if (!surface) { setError(SELECTION_INVALID_ERROR); return; }
    launchingRef.current = true;
    try {
      const controller = await onRunAction({ itemId, action, selection: { ...selection }, ...(action === "translate" ? { language } : {}) });
      if (!controller) throw new Error("The assistant is unavailable. Try again.");
      if (!aliveRef.current || !surface.column.isConnected) { controller.dispose(); return; }
      setError(null); setTranslating(false);
      setPreview({ controller, surface });
    } catch (error) {
      if (aliveRef.current) setError(error instanceof Error ? error.message : "Could not start this preview.");
    } finally { launchingRef.current = false; }
  };

  if (!enabled) return null;
  if (preview) return <InlineSelectionPreview {...preview} readSelection={readSelection} onClose={() => { setPreview(null); setAnchor(null); }} />;
  if (!anchor) return null;

  return (
    <div
      ref={barRef}
      className={`${previewStyles.palette} ${styles.bar}`}
      style={{ left: anchor.left, top: anchor.top }}
      role="toolbar"
      aria-label="AI actions for the selected text"
      // Taking focus would collapse the selection the actions are about.
      onMouseDown={(event) => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault(); }}
    >
      {error && <div role="alert" className={styles.error}>{error}</div>}
      {translating ? <form className={styles.languages} onSubmit={(event) => { event.preventDefault(); void run("translate"); }}>
        <label>Translate to <input autoFocus aria-label="Translation language" list="inline-translation-languages" value={language} maxLength={80}
          onChange={(event) => setLanguage(event.target.value)} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing && event.key === "Enter") event.preventDefault();
            if (event.key === "Escape") { event.stopPropagation(); setTranslating(false); }
          }} /></label>
        <datalist id="inline-translation-languages">
          {["English", "Spanish", "French", "German", "Portuguese", "Japanese", "Chinese", "Korean", "Arabic", "Hindi"].map((name) => <option key={name} value={name} />)}
        </datalist>
        <button className={styles.action} type="submit" disabled={!language.trim()}>Translate</button>
        <button className={styles.action} type="button" onClick={() => setTranslating(false)}>Cancel</button>
      </form> : SELECTION_ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          className={styles.action}
          title={action.title}
          onClick={() => void run(action.id)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
