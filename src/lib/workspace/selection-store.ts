"use client";

// The workspace's item selection, held OUTSIDE the shell component tree.
//
// Selection is the hottest state in the workspace - every j/k press, click
// and marquee drag writes it - and as React state at the top of the shell it
// re-rendered the entire 7,000-line tree per keystroke. As a store, writers
// call plain functions and only subscribed leaves re-render: a row cares
// about its own two booleans, the toolbar about the set, and the shell's
// logic reads snapshots inside callbacks without any render dependency.
//
// The anchor (shift-extend origin) lives here too but has no subscribers:
// it is bookkeeping for the next write, never rendered.

import { useSyncExternalStore } from "react";

export type WorkspaceSelectionState = {
  activeId: string | null;
  ids: ReadonlySet<string>;
  anchorId: string | null;
};

const EMPTY_IDS: ReadonlySet<string> = new Set();

let state: WorkspaceSelectionState = {
  activeId: null,
  ids: EMPTY_IDS,
  anchorId: null,
};

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeWorkspaceSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getWorkspaceSelection(): WorkspaceSelectionState {
  return state;
}

export function setWorkspaceSelection(
  next: Partial<WorkspaceSelectionState>,
): void {
  const merged: WorkspaceSelectionState = {
    activeId: next.activeId !== undefined ? next.activeId : state.activeId,
    ids: next.ids !== undefined ? next.ids : state.ids,
    anchorId: next.anchorId !== undefined ? next.anchorId : state.anchorId,
  };
  if (
    merged.activeId === state.activeId &&
    merged.ids === state.ids &&
    merged.anchorId === state.anchorId
  ) {
    return;
  }
  state = merged;
  emit();
}

export function selectOnlyWorkspacePost(postId: string | null): void {
  setWorkspaceSelection({
    activeId: postId,
    anchorId: postId,
    ids: postId ? new Set([postId]) : EMPTY_IDS,
  });
}

export function clearWorkspaceSelection(): void {
  setWorkspaceSelection({ activeId: null, anchorId: null, ids: EMPTY_IDS });
}

/** The full selection, for components that render the set (toolbar, lists). */
export function useWorkspaceSelection(): WorkspaceSelectionState {
  return useSyncExternalStore(
    subscribeWorkspaceSelection,
    getWorkspaceSelection,
    getWorkspaceSelection,
  );
}

/**
 * One row's slice: whether THIS post is selected and whether it is the
 * active row. The snapshot is a two-bit encoding so an unrelated selection
 * change does not re-render the row.
 */
export function useWorkspacePostSelection(postId: string | null): {
  selected: boolean;
  active: boolean;
} {
  const bits = useSyncExternalStore(
    subscribeWorkspaceSelection,
    () =>
      (postId && state.ids.has(postId) ? 2 : 0) |
      (postId && state.activeId === postId ? 1 : 0),
    () => 0,
  );
  return { selected: (bits & 2) !== 0, active: (bits & 1) !== 0 };
}
