import type { InlineSelectionSurface } from "@/components/document/inline-selection-surface";
import type { InlinePreviewController } from "./inline-preview";

export const SELECTION_PREVIEW_EVENT = "texttext:selection-preview";
export type SelectionPreviewEventDetail = {
  itemId: string;
  controller: InlinePreviewController;
  surface: InlineSelectionSurface;
  accepted: boolean;
};
/** Deliver to the mounted editor, never to whichever chat is now visible. */
export function presentSelectionPreview(detail: Omit<SelectionPreviewEventDetail, "accepted">): boolean {
  const message: SelectionPreviewEventDetail = { ...detail, accepted: false };
  window.dispatchEvent(new CustomEvent(SELECTION_PREVIEW_EVENT, { detail: message }));
  if (!message.accepted) detail.controller.dispose();
  return message.accepted;
}
