"use client";

// The action bar's right slot, reached by portal. In its own module so the
// editor can use it without importing PostActionBar, whose server-action
// imports reach next-auth and next/server: that graph loads in the browser but
// fails under vitest, which took pre-ready-edits.test.ts down with it.

import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function WorkspaceActionBarPortal({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const findSlot = () => {
      const nextSlot = document.querySelector<HTMLElement>(
        ".post-editor-content > .workspace-action-bar-host .workspace-action-bar-slot.is-right",
      );
      if (!nextSlot) return false;
      setSlot(nextSlot);
      return true;
    };

    if (findSlot()) return;
    const observer = new MutationObserver(() => {
      if (findSlot()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return slot ? createPortal(children, slot) : children;
}
