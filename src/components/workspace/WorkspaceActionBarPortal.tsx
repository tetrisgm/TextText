"use client";

// The action bar's content slots, reached by portal. In its own module so the
// editor can use it without importing PostActionBar, whose server-action
// imports reach next-auth and next/server: that graph loads in the browser but
// fails under vitest, which took pre-ready-edits.test.ts down with it.

import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type WorkspaceActionBarPortalProps = {
  children: ReactNode;
  slot?: "middle" | "right";
};

export function WorkspaceActionBarPortal({
  children,
  slot = "right",
}: WorkspaceActionBarPortalProps) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const findSlot = () => {
      const selector =
        slot === "middle"
          ? ".post-editor-content > .workspace-action-bar-host .workspace-action-bar-slot.is-middle"
          : ".post-editor-content > .workspace-action-bar-host .workspace-action-bar-slot.is-right";
      const nextSlot = document.querySelector<HTMLElement>(
        selector,
      );
      if (!nextSlot) return false;
      setTarget(nextSlot);
      return true;
    };

    if (findSlot()) return;
    const observer = new MutationObserver(() => {
      if (findSlot()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [slot]);

  return target ? createPortal(children, target) : children;
}
