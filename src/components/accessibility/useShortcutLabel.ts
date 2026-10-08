"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const serverPlatform = () => "";
const browserPlatform = () => navigator.platform;

export function shortcutLabel(keys: string, platform: string): string {
  if (/Mac|iPhone|iPad|iPod/i.test(platform)) return keys;
  return keys.replace(/⌘\s*/g, "Ctrl+").replace(/⇧/g, "Shift+").replace(/⌥/g, "Alt+");
}

/** Server and hydration use the same neutral fallback; platform changes after hydration. */
export function useShortcutLabel(): (keys: string) => string {
  const platform = useSyncExternalStore(subscribe, browserPlatform, serverPlatform);
  return keys => shortcutLabel(keys, platform);
}
