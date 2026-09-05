import type { WorkspaceItemTextSelection } from "@/lib/ai/workspace-item-draft";

export type InlineSelectionSurface = {
  column: HTMLElement;
  passage: () => HTMLElement | null;
  restore: () => void;
};
type SurfaceFactory = (selection: WorkspaceItemTextSelection) => InlineSelectionSurface;
const surfaces = new WeakMap<HTMLElement, SurfaceFactory>();

/** The source editor owns offset-to-DOM mapping, including windowed lines. */
export function registerInlineSelectionSurface(root: HTMLElement, factory: SurfaceFactory) {
  surfaces.set(root, factory);
  return () => { if (surfaces.get(root) === factory) surfaces.delete(root); };
}
export function captureInlineSelectionSurface(itemId: string, selection: WorkspaceItemTextSelection): InlineSelectionSurface | null {
  const editor = Array.from(document.querySelectorAll<HTMLElement>("[data-ai-item-id]"))
    .find((node) => node.dataset.aiItemId === itemId);
  if (!editor) return null;
  if (selection.field === "body") {
    const root = editor.querySelector<HTMLElement>(".tt-field-body .tt-md-surface");
    return root ? surfaces.get(root)?.(selection) ?? null : null;
  }
  const field = selection.field === "excerpt" ? "subtitle" : "title";
  const column = editor.querySelector<HTMLElement>(`.tt-field-${field}`);
  const input = column?.querySelector("textarea");
  if (!column || !input) return null;
  return {
    column, passage: () => column.isConnected ? column : null,
    restore() {
      if (!input.isConnected) return;
      input.focus({ preventScroll: true });
      const end = Math.min(selection.end, input.value.length);
      const start = input.value.slice(selection.start, selection.end) === selection.text ? selection.start : end;
      input.setSelectionRange(start, end);
      input.dispatchEvent(new Event("select", { bubbles: true }));
    },
  };
}
