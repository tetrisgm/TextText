export type WorkspaceSelectionState = {
  activeId: string | null;
  anchorId: string | null;
  selectedIds: Set<string>;
};

export function orderedSelectionRange(
  orderedIds: readonly string[],
  anchorId: string,
  targetId: string,
): Set<string> {
  const anchorIndex = orderedIds.indexOf(anchorId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0) return new Set([targetId]);
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return new Set(orderedIds.slice(start, end + 1));
}

export function selectionFromClick({
  anchorId,
  orderedIds,
  range,
  selectedIds,
  targetId,
  toggle,
}: {
  anchorId: string | null;
  orderedIds: readonly string[];
  range: boolean;
  selectedIds: ReadonlySet<string>;
  targetId: string;
  toggle: boolean;
}): WorkspaceSelectionState & { open: boolean } {
  if (range) {
    const anchor = anchorId && orderedIds.includes(anchorId) ? anchorId : targetId;
    return {
      activeId: targetId,
      anchorId: anchor,
      selectedIds: orderedSelectionRange(orderedIds, anchor, targetId),
      open: false,
    };
  }
  if (toggle) {
    const next = new Set(selectedIds);
    if (next.has(targetId)) next.delete(targetId);
    else next.add(targetId);
    return {
      activeId: next.has(targetId) ? targetId : (Array.from(next).at(-1) ?? null),
      anchorId: targetId,
      selectedIds: next,
      open: false,
    };
  }
  return {
    activeId: targetId,
    anchorId: targetId,
    selectedIds: new Set([targetId]),
    open: true,
  };
}

export function extendSelectionByKeyboard({
  activeId,
  anchorId,
  direction,
  orderedIds,
  targetId,
}: {
  activeId: string | null;
  anchorId: string | null;
  direction: -1 | 1;
  orderedIds: readonly string[];
  targetId?: string | null;
}): WorkspaceSelectionState {
  if (orderedIds.length === 0) {
    return { activeId: null, anchorId: null, selectedIds: new Set() };
  }
  const currentIndex = activeId ? orderedIds.indexOf(activeId) : -1;
  const fallbackIndex = direction > 0 ? 0 : orderedIds.length - 1;
  const requestedIndex = targetId ? orderedIds.indexOf(targetId) : -1;
  const nextIndex =
    requestedIndex >= 0
      ? requestedIndex
      : currentIndex < 0
        ? fallbackIndex
        : Math.max(
            0,
            Math.min(orderedIds.length - 1, currentIndex + direction),
          );
  const nextId = orderedIds[nextIndex]!;
  const anchor =
    anchorId && orderedIds.includes(anchorId)
      ? anchorId
      : activeId && orderedIds.includes(activeId)
        ? activeId
        : nextId;
  return {
    activeId: nextId,
    anchorId: anchor,
    selectedIds: orderedSelectionRange(orderedIds, anchor, nextId),
  };
}

export type SelectionRectangle = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export function rectanglesIntersect(
  left: SelectionRectangle,
  right: SelectionRectangle,
): boolean {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  );
}

export function marqueeSelectionIds({
  additiveIds = [],
  items,
  rectangle,
}: {
  additiveIds?: Iterable<string>;
  items: ReadonlyArray<{ id: string; rectangle: SelectionRectangle }>;
  rectangle: SelectionRectangle;
}): Set<string> {
  const selected = new Set(additiveIds);
  for (const item of items) {
    if (rectanglesIntersect(rectangle, item.rectangle)) selected.add(item.id);
  }
  return selected;
}
