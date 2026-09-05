// Undo and redo reach the mounted editor through window events, the same way
// stop-local-editing does. The command bar, the keyboard shortcut and the Mac
// Edit menu all raise these; the editor that owns the document answers. When
// no editor is mounted, nothing listens and nothing happens, which is the
// right outcome for Cmd+Z on a list view.
export const DOCUMENT_UNDO_EVENT = "texttext:document-undo";
export const DOCUMENT_REDO_EVENT = "texttext:document-redo";

export function requestDocumentUndo(): void {
  window.dispatchEvent(new Event(DOCUMENT_UNDO_EVENT));
}

export function requestDocumentRedo(): void {
  window.dispatchEvent(new Event(DOCUMENT_REDO_EVENT));
}

// Whether any document editor is currently mounted and listening. The
// shortcut is gated on this rather than on the view level: editing happens in
// more places than the canonical edit route - notes edit in place, and the
// root view has its own composer - and with no editor mounted, Cmd+Z should
// fall through to the browser so plain fields keep their native undo.
let mountedEditors = 0;

export function registerDocumentHistory(): () => void {
  mountedEditors += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mountedEditors -= 1;
  };
}

export function documentHistoryAvailable(): boolean {
  return mountedEditors > 0;
}

// Where the caret was when an undo step was recorded, so undo can put it
// back. Sublime restores the selection that belonged to the edit it is
// undoing rather than leaving the caret wherever it happened to be, and that
// is what makes undo feel like stepping back through your own work.
let bodySelection: { anchor: number; head: number } | null = null;

export function setActiveBodySelection(
  selection: { anchor: number; head: number } | null,
): void {
  bodySelection = selection;
}

export function activeBodySelection(): { anchor: number; head: number } | null {
  return bodySelection;
}

/** Raised with `{ anchor, head }`; the editing surface places the caret. */
export const DOCUMENT_SET_CARET_EVENT = "texttext:document-set-caret";

export function requestDocumentCaret(
  anchor: number,
  head: number,
  options: { align?: "top" } = {},
): void {
  window.dispatchEvent(
    new CustomEvent(DOCUMENT_SET_CARET_EVENT, {
      detail: { anchor, head, align: options.align },
    }),
  );
}
