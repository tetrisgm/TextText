"use client";

import { useEffect, type RefObject } from "react";

const dialogs: HTMLElement[] = [];
// Baselines belong to the manager, never to another modal's temporary snapshot.
const inertBaselines = new Map<HTMLElement, boolean>();
function updateModalInert() {
  for (const [element, original] of inertBaselines) {
    element.toggleAttribute("inert", original || element.getAttribute?.("aria-hidden") === "true");
  }
  const root = dialogs.at(-1);
  if (!root) { inertBaselines.clear(); return; }
  // Only the top modal defines the blocked branches, so it cannot inherit an
  // inert ancestor installed by a lower dialog, including non-LIFO exits.
  for (let branch: HTMLElement = root; branch.parentElement; branch = branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling !== branch && sibling instanceof HTMLElement && !sibling.contains(root)) {
        if (!inertBaselines.has(sibling)) inertBaselines.set(sibling, sibling.inert);
        sibling.toggleAttribute("inert", true);
      }
    }
    if (branch.parentElement === document.body) break;
  }
}
const selector = 'button, a[href], input, select, textarea, summary, [tabindex], [contenteditable="true"]';

export function dialogControls(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((element) =>
    element.tabIndex >= 0 && !element.matches(':disabled') &&
    !element.closest('[inert], [hidden]') && element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden',
  );
}

/** A modal owns focus only while it is the top dialog. Existing Escape layers
 * own dismissal. Preserve pre-existing inert state and recover removed controls. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    const root = ref.current;
    if (!open || !root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnRegion = previous?.closest<HTMLElement>('main, [role="main"], nav, aside');
    dialogs.push(root);
    updateModalInert();
    const top = () => dialogs.at(-1) === root;
    const focusFirst = () => (dialogControls(root)[0] ?? root).focus({ preventScroll: true });
    if (!root.hasAttribute('tabindex')) root.tabIndex = -1;
    if (!root.contains(document.activeElement)) focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (!top() || event.key !== 'Tab') return;
      const controls = dialogControls(root);
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (!controls.length || index < 0 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
        event.preventDefault();
        (controls[event.shiftKey ? controls.length - 1 : 0] ?? root).focus();
      }
    };
    const focusin = () => {
      if (top() && !root.contains(document.activeElement)) focusFirst();
    };
    const observer = new MutationObserver(() => {
      if (top() && (document.activeElement === document.body ||
        (root.contains(document.activeElement) && (document.activeElement as HTMLElement).matches(':disabled')))) focusFirst();
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusin);
      const wasTop = top();
      dialogs.splice(dialogs.indexOf(root), 1);
      updateModalInert();
      if (!wasTop) return;
      // A command may deliberately focus its destination before this cleanup.
      const active = document.activeElement;
      if (active !== document.body && active !== previous && active?.isConnected && !root.contains(active)) return;
      const target = previous?.isConnected && !previous.matches(':disabled') && !previous.closest('[inert]')
        ? previous
        : dialogs.at(-1) ?? returnRegion ?? document.querySelector<HTMLElement>('main, [role="main"]');
      if (target?.isConnected) {
        if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    };
  }, [open, ref]);
}

/** Non-modal comment sheets permit Tab to leave. Return focus only when closing
 * would otherwise remove it, so light dismissal never steals a clicked control. */
export function usePopoverFocus(ref: RefObject<HTMLElement | null>, open: boolean, contentSelector?: string) {
  useEffect(() => {
    const root = contentSelector ? ref.current?.querySelector<HTMLElement>(contentSelector) : ref.current;
    if (!open || !root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const region = previous?.closest<HTMLElement>('main, [role="main"]') ?? document.querySelector<HTMLElement>('main');
    (dialogControls(root)[0] ?? root).focus({ preventScroll: true });
    return () => {
      if (document.activeElement !== document.body && !root.contains(document.activeElement)) return;
      const target = previous?.isConnected && !previous.matches(':disabled') ? previous : region;
      if (target) {
        if (!target.hasAttribute('tabindex') && target.tabIndex < 0) target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    };
  }, [contentSelector, open, ref]);
}
