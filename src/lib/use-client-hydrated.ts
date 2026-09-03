"use client";

// True only after hydration: the SSR pass and the first client render agree,
// then client-only knowledge may flow in. Shared by the workspace shell and
// the item views it split into.

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function useClientHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
