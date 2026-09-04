// The item shown beside the one being worked on: notes next to a draft, a
// reference next to the thing referencing it.
//
// This is deliberately NOT a second navigable pane. The shell's whole model -
// one view, one history index, one snapshot per index - assumes a single
// place at a time, and giving the second pane its own navigation would mean
// rebuilding that. The second pane holds ONE document and reads it.

import { useSyncExternalStore } from "react";

const STORAGE_PREFIX = "texttext:split-item:";

let scope = "";
let splitPostId: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  if (!scope) return;
  try {
    if (splitPostId) {
      window.localStorage.setItem(`${STORAGE_PREFIX}${scope}`, splitPostId);
    } else {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${scope}`);
    }
  } catch {
    /* private mode or quota: the pane is a convenience */
  }
}

/** Adopt a workspace's remembered split, once, on mount. */
export function useSplitScope(homePath: string): void {
  if (scope !== homePath) {
    scope = homePath;
    try {
      splitPostId = window.localStorage.getItem(`${STORAGE_PREFIX}${homePath}`);
    } catch {
      splitPostId = null;
    }
    // No emit: this runs during the first render for this scope, and the
    // subscriber below reads the value it just set.
  }
}

export function openInSplit(postId: string): void {
  if (splitPostId === postId) return;
  splitPostId = postId;
  persist();
  emit();
}

export function closeSplit(): void {
  if (splitPostId === null) return;
  splitPostId = null;
  persist();
  emit();
}

export function toggleSplit(postId: string | null): void {
  if (splitPostId) {
    closeSplit();
    return;
  }
  if (postId) openInSplit(postId);
}

export function currentSplitPostId(): string | null {
  return splitPostId;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSplitPostId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => splitPostId,
    () => null,
  );
}
