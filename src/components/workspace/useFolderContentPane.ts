"use client";

import { useCallback, useSyncExternalStore } from "react";

type FolderContentPane = "items" | "news";
const changed = "texttext:folder-content-changed";
const fallback = new Map<string, FolderContentPane>();

export function useFolderContentPane(folderId: string, defaultPane: FolderContentPane) {
  const key = `texttext:folder-content:${folderId}`;
  const subscribe = useCallback((notify: () => void) => {
    const storageChanged = (event: StorageEvent) => {
      if (event.key) fallback.delete(event.key);
      else fallback.clear();
      notify();
    };
    window.addEventListener("storage", storageChanged);
    window.addEventListener(changed, notify);
    return () => {
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener(changed, notify);
    };
  }, []);
  const snapshot = useCallback((): FolderContentPane => {
    const sessionChoice = fallback.get(key);
    if (sessionChoice) return sessionChoice;
    let saved: string | null | undefined;
    try {
      saved = window.localStorage.getItem(key);
    } catch {
      saved = fallback.get(key);
    }
    return saved === "items" || saved === "news" ? saved : defaultPane;
  }, [key, defaultPane]);
  const pane = useSyncExternalStore(subscribe, snapshot, () => defaultPane);
  const setPane = useCallback((next: FolderContentPane) => {
    try {
      window.localStorage.setItem(key, next);
      fallback.delete(key);
    } catch {
      // The choice still works for this session when storage is unavailable.
      fallback.set(key, next);
    }
    window.dispatchEvent(new Event(changed));
  }, [key]);
  return [pane, setPane] as const;
}
