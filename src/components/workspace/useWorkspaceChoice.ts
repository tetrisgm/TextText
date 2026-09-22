"use client";

import { useCallback, useSyncExternalStore } from "react";

const changed = "texttext:workspace-choice";
const session = new Map<string, string>();

/** A local view preference, independent of document data and folder defaults. */
export function useWorkspaceChoice(key: string, choices: readonly string[], defaultValue: string) {
  const subscribe = useCallback((notify: () => void) => {
    const storage = (event: StorageEvent) => {
      if (event.key) session.delete(event.key); else session.clear();
      notify();
    };
    window.addEventListener("storage", storage);
    window.addEventListener(changed, notify);
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener(changed, notify);
    };
  }, []);
  const snapshot = useCallback(() => {
    let value = session.get(key);
    if (value === undefined) {
      try { value = window.localStorage.getItem(key) ?? undefined; } catch { /* Session preference remains usable. */ }
    }
    return value !== undefined && choices.includes(value) ? value : defaultValue;
  }, [key, choices, defaultValue]);
  const value = useSyncExternalStore(subscribe, snapshot, () => defaultValue);
  const select = useCallback((next: string) => {
    if (!choices.includes(next)) return;
    session.set(key, next);
    try { window.localStorage.setItem(key, next); } catch { /* Keep the session choice. */ }
    window.dispatchEvent(new Event(changed));
  }, [key, choices]);
  return [value, select] as const;
}
