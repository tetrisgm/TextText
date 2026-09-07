"use client";
import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { surfaceMotion } from "./surface";

/** Explicit closes animate; native light dismiss remains available without JS. */
export function usePopoverMotion(popover: RefObject<HTMLElement | null>, trigger: RefObject<HTMLButtonElement | null>) {
  const actions = useRef<{ open: () => void; close: () => void } | null>(null);
  const shown = useRef(false);
  const close = useCallback(() => actions.current?.close(), []);
  const open = useCallback(() => actions.current?.open(), []);
  useLayoutEffect(() => {
    const node = popover.current, button = trigger.current;
    if (!node || !button) return;
    const animation = surfaceMotion(node, { origin: button, onRest: (open) => { if (!open) node.hidePopover(); } });
    actions.current = {
      close() {
        shown.current = false; animation.show(false);
        if (node.contains(document.activeElement)) button.focus();
      },
      open() {
        shown.current = true;
        if (node.matches(":popover-open")) animation.show(true, button);
        else node.showPopover();
      },
    };
    let frame = 0;
    const toggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open") {
        shown.current = false;
        cancelAnimationFrame(frame);
        animation.finish(false);
        return;
      }
      shown.current = true;
      // Native layout and React's anchored position are installed before measuring.
      frame = requestAnimationFrame(() => { if (shown.current) animation.show(true, button); });
    };
    const click = (event: MouseEvent) => {
      event.preventDefault();
      if (shown.current) close();
      else open();
    };
    node.addEventListener("beforetoggle", toggle);
    button.addEventListener("click", click);
    return () => {
      cancelAnimationFrame(frame); animation.dispose(); actions.current = null;
      node.removeEventListener("beforetoggle", toggle); button.removeEventListener("click", click);
    };
  }, [popover, trigger, close, open]);
  return { close, open };
}
