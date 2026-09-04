// Dragging items onto a folder.
//
// A row is draggable only once it is SELECTED. That is Finder's rule and it
// is what lets both gestures live on the same pixel: drag an unselected row
// and the rubber-band starts, drag a selected one and you are moving it. A
// row that is always draggable would let the browser's own drag preempt the
// marquee, which is exactly what happened when it was tried.

export const ITEM_DRAG_TYPE = "application/x-texttext-post-ids";

export function writeItemDrag(
  transfer: DataTransfer,
  postIds: readonly string[],
): void {
  if (postIds.length === 0) return;
  transfer.effectAllowed = "move";
  transfer.setData(ITEM_DRAG_TYPE, JSON.stringify(postIds));
  // Some engines only expose a drag at all when text/plain is set.
  transfer.setData("text/plain", postIds.join("\n"));
}

export function readItemDrag(transfer: DataTransfer | null): string[] {
  if (!transfer) return [];
  try {
    const raw = transfer.getData(ITEM_DRAG_TYPE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** True when a drag carries items, without reading them: dragover cannot. */
export function dragCarriesItems(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  return Array.from(transfer.types).includes(ITEM_DRAG_TYPE);
}
