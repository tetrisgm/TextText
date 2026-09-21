"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

const selector = "[data-return-focus-key]";

/** Wait for a cached or asynchronously loaded row without moving its scroller. */
export function restoreListReturnFocus(container: HTMLElement, key: string) {
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    observer.disconnect();
    document.removeEventListener("pointerdown", stop, true);
    document.removeEventListener("keydown", stop, true);
  };
  const restore = () => {
    if (stopped) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active.isContentEditable || active.matches("input, textarea, select"))) {
      stop();
      return;
    }
    const target = Array.from(container.querySelectorAll<HTMLElement>(selector))
      .find((row) => row.dataset.returnFocusKey === key && row.getClientRects().length > 0 && !row.closest("[inert], [hidden]"));
    if (!target) return;
    target.focus({ preventScroll: true });
    stop();
  };
  document.addEventListener("pointerdown", stop, true);
  document.addEventListener("keydown", stop, true);
  const observer = new MutationObserver(restore);
  observer.observe(container, { childList: true, subtree: true });
  const timer = setTimeout(stop, 2000);
  restore();
  return stop;
}

export function useListReturnFocus(container: RefObject<HTMLElement | null>, viewKey: string) {
  const memory = useRef(new Map<string, string>());
  const remember = useCallback((target: EventTarget) => {
    if (!(target instanceof Element)) return;
    const row = target.closest<HTMLElement>(selector);
    const key = row?.dataset.returnFocusKey;
    if (!key || !container.current?.contains(row)) return;
    memory.current.delete(viewKey);
    memory.current.set(viewKey, key);
    if (memory.current.size > 100) memory.current.delete(memory.current.keys().next().value!);
  }, [container, viewKey]);
  useEffect(() => {
    const key = memory.current.get(viewKey);
    if (key && container.current) return restoreListReturnFocus(container.current, key);
  }, [container, viewKey]);
  return remember;
}
