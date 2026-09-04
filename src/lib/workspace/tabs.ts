// Open documents, as tabs - the Sublime arrangement.
//
// A tab is not a second view: selecting one navigates the workspace to that
// item exactly as clicking it in a list does, so the open document is always
// the real, fully editable one. That is why tabs suit this shell where a
// split pane could not: the model is one view at a time, and tabs are a set
// of documents with one of them current, not two views at once.
//
// Preview tabs follow Sublime: opening an item ordinarily REPLACES the
// preview slot rather than adding to the strip, so browsing a folder does not
// leave a trail of tabs behind. Anything deliberate - opening in a new tab,
// double-clicking the tab, or starting to edit - makes it permanent.

import { useSyncExternalStore } from "react";

const STORAGE_PREFIX = "texttext:tabs:";
/** Enough for a working session; the oldest falls off rather than growing. */
const MAX_TABS = 20;
/** How many closed tabs Cmd+Shift+T can walk back through. */
const MAX_REOPEN = 20;

type State = {
  ids: readonly string[];
  /** The one tab that a plain open will replace, as in Sublime. */
  preview: string | null;
};

let scope = "";
let state: State = { ids: [], preview: null };
let closed: readonly string[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  if (!scope) return;
  try {
    if (state.ids.length) {
      window.localStorage.setItem(
        `${STORAGE_PREFIX}${scope}`,
        JSON.stringify({ ids: state.ids, preview: state.preview }),
      );
    } else {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${scope}`);
    }
  } catch {
    /* private mode or quota: tabs are a convenience */
  }
}

function read(homePath: string): State {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${homePath}`);
    if (!raw) return { ids: [], preview: null };
    const parsed = JSON.parse(raw) as unknown;
    // Older sessions stored a bare array of ids.
    const list = Array.isArray(parsed)
      ? parsed
      : ((parsed as { ids?: unknown })?.ids ?? null);
    if (!Array.isArray(list)) return { ids: [], preview: null };
    const ids: string[] = [];
    for (const entry of list) {
      if (typeof entry !== "string") return { ids: [], preview: null };
      ids.push(entry);
    }
    const previewRaw = Array.isArray(parsed)
      ? null
      : (parsed as { preview?: unknown })?.preview;
    const preview =
      typeof previewRaw === "string" && ids.includes(previewRaw)
        ? previewRaw
        : null;
    return { ids: ids.slice(-MAX_TABS), preview };
  } catch {
    return { ids: [], preview: null };
  }
}

/** Adopt a workspace's remembered tabs. Runs during render for a new scope. */
export function useTabScope(homePath: string): void {
  if (scope !== homePath) {
    scope = homePath;
    state = read(homePath);
    closed = [];
  }
}

function commit(next: State): void {
  state = next;
  persist();
  emit();
}

/**
 * Note an open document.
 *
 * `preview` is the ordinary case - clicking through a list - and takes over
 * the preview slot instead of growing the strip. `permanent` is the
 * deliberate case: opening in a new tab, or editing.
 */
export function openTab(
  postId: string,
  options: { preview?: boolean } = {},
): void {
  const preview = options.preview ?? false;
  if (state.ids.includes(postId)) {
    // Already open. A deliberate open promotes it out of the preview slot.
    if (!preview && state.preview === postId) {
      commit({ ...state, preview: null });
    }
    return;
  }
  if (preview && state.preview) {
    // Replace the preview in place, so the strip does not shuffle.
    const at = state.ids.indexOf(state.preview);
    const ids = state.ids.slice();
    if (at >= 0) ids[at] = postId;
    else ids.push(postId);
    commit({ ids: ids.slice(-MAX_TABS), preview: postId });
    return;
  }
  commit({
    ids: [...state.ids, postId].slice(-MAX_TABS),
    preview: preview ? postId : state.preview,
  });
}

/** Make a tab stick around: a double click, or the first real edit. */
export function promoteTab(postId: string): void {
  if (state.preview !== postId) return;
  commit({ ...state, preview: null });
}

/**
 * Drop a tab and say where to go if it was the one open: the tab to its left,
 * else the one to its right, else nowhere (the list).
 */
export function closeTab(postId: string): string | null {
  const index = state.ids.indexOf(postId);
  if (index === -1) return null;
  const next = state.ids[index - 1] ?? state.ids[index + 1] ?? null;
  closed = [...closed.filter((id) => id !== postId), postId].slice(-MAX_REOPEN);
  commit({
    ids: state.ids.filter((entry) => entry !== postId),
    preview: state.preview === postId ? null : state.preview,
  });
  return next;
}

/** Cmd+Shift+T: bring back the most recently closed tab. */
export function reopenClosedTab(): string | null {
  const postId = closed[closed.length - 1];
  if (!postId) return null;
  closed = closed.slice(0, -1);
  if (!state.ids.includes(postId)) {
    commit({ ids: [...state.ids, postId].slice(-MAX_TABS), preview: state.preview });
  } else {
    emit();
  }
  return postId;
}

/** Drag to reorder: put the tab at `from` where `to` is. */
export function moveTab(from: number, to: number): void {
  const ids = state.ids.slice();
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return;
  if (from === to) return;
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  commit({ ...state, ids });
}

/** Forget tabs whose documents are gone (deleted, or moved out of reach). */
export function pruneTabs(exists: (postId: string) => boolean): void {
  const kept = state.ids.filter((postId) => exists(postId));
  if (kept.length === state.ids.length) return;
  commit({
    ids: kept,
    preview: state.preview && kept.includes(state.preview) ? state.preview : null,
  });
}

/** The tab `step` places from `current`, wrapping. */
export function tabAfter(current: string | null, step: number): string | null {
  const ids = state.ids;
  if (ids.length === 0) return null;
  const index = current ? ids.indexOf(current) : -1;
  if (index === -1) return ids[step > 0 ? 0 : ids.length - 1] ?? null;
  return ids[(index + step + ids.length) % ids.length] ?? null;
}

export function currentTabs(): readonly string[] {
  return state.ids;
}

export function currentPreviewTab(): string | null {
  return state.preview;
}

export function hasClosedTabs(): boolean {
  return closed.length > 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTabState(): State {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY_STATE,
  );
}

const EMPTY_STATE: State = { ids: [], preview: null };
