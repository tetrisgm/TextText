import { dialogControls } from "./useDialogFocus";

type KeyEvent = { key: string; defaultPrevented?: boolean; preventDefault: () => void; stopPropagation: () => void };

/** Dismiss the closest disclosure before Escape reaches the editor's Done action. */
export function dismissOpenDetails(target: EventTarget | null, event: KeyEvent): boolean {
  if (event.key !== "Escape" || !(target instanceof HTMLElement)) return false;
  const details = target.closest<HTMLDetailsElement>("details[open]");
  if (!details) return false;
  event.preventDefault();
  event.stopPropagation();
  details.open = false;
  details.querySelector<HTMLElement>("summary")?.focus();
  return true;
}

export function moveMenuFocus(root: HTMLElement, event: KeyEvent) {
  if (event.defaultPrevented || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const controls = dialogControls(root);
  if (!controls.length) return;
  const current = controls.indexOf(document.activeElement as HTMLElement);
  const index = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1
    : (Math.max(0, current) + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
  event.preventDefault();
  event.stopPropagation();
  controls[index].focus();
}
