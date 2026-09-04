// Open documents, as tabs - the Sublime arrangement.
//
// A tab is not a second view: selecting one navigates the workspace to that
// item exactly as clicking it in a list does, so the open document is always
// the real, fully editable one. That is the whole reason tabs suit this shell
// where a split pane did not: the shell's model is one view at a time, and
// tabs are a set of documents with one of them current, not two views at
// once. Nothing here downgrades what you can do with the document.

import { useSyncExternalStore } from "react";

const STORAGE_PREFIX = "texttext:tabs:";
/** Enough for a working session; the oldest falls off rather than growing. */
const MAX_TABS = 20;

let scope = "";
let tabs: readonly string[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  if (!scope) return;
  try {
    if (tabs.length) {
      window.localStorage.setItem(`${STORAGE_PREFIX}${scope}`, JSON.stringify(tabs));
    } else {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${scope}`);
    }
  } catch {
    /* private mode or quota: tabs are a convenience */
  }
}

function read(homePath: string): readonly string[] {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${homePath}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string") return [];
      out.push(entry);
    }
    return out.slice(-MAX_TABS);
  } catch {
    return [];
  }
}

/** Adopt a workspace's remembered tabs. Runs during render for a new scope. */
export function useTabScope(homePath: string): void {
  if (scope !== homePath) {
    scope = homePath;
    tabs = read(homePath);
  }
}

export function openTab(postId: string): void {
  if (tabs.includes(postId)) return;
  tabs = [...tabs, postId].slice(-MAX_TABS);
  persist();
  emit();
}

/**
 * Drop a tab and say where to go if it was the one open: the tab to its left,
 * else the one to its right, else nowhere (the list).
 */
export function closeTab(postId: string): string | null {
  const index = tabs.indexOf(postId);
  if (index === -1) return null;
  const next = tabs[index - 1] ?? tabs[index + 1] ?? null;
  tabs = tabs.filter((entry) => entry !== postId);
  persist();
  emit();
  return next;
}

/** Forget tabs whose documents are gone (deleted, or moved out of reach). */
export function pruneTabs(exists: (postId: string) => boolean): void {
  const kept = tabs.filter((postId) => exists(postId));
  if (kept.length === tabs.length) return;
  tabs = kept;
  persist();
  emit();
}

/** The tab `step` places from `current`, wrapping. */
export function tabAfter(current: string | null, step: number): string | null {
  if (tabs.length === 0) return null;
  const index = current ? tabs.indexOf(current) : -1;
  if (index === -1) return tabs[step > 0 ? 0 : tabs.length - 1] ?? null;
  const next = (index + step + tabs.length) % tabs.length;
  return tabs[next] ?? null;
}

export function currentTabs(): readonly string[] {
  return tabs;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: readonly string[] = [];

export function useTabs(): readonly string[] {
  return useSyncExternalStore(
    subscribe,
    () => tabs,
    () => EMPTY,
  );
}
