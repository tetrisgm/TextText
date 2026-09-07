import { rememberMotionOrigin } from "./origin";
import { spring, type FrameClock } from "./spring";
import { readPreferences } from "./preferences";

export const pressScope = '[role="toolbar"], .post-action-toolbar, .folder-action-toolbar, .blog-home-action-toolbar, .workspace-root-action-toolbar, .workspace-library-toolbar, .ac-toolbar, .workspace-tab-bar, [data-assistant-sidebar]';
export function pressMotion(node: HTMLElement, clock?: FrameClock) {
  const saved = { scale: node.style.scale, opacity: node.style.opacity, willChange: node.style.willChange, transform: node.style.transform };
  let reduced = false;
  const motion = spring(1, { clock,
    onUpdate: (value) => {
      node.style.scale = reduced ? saved.scale : String(value);
      node.style.opacity = reduced ? String(1 - (1 - value) * 5) : saved.opacity;
    },
    onRest: () => { node.style.willChange = saved.willChange; if (motion.target === 1) { Object.assign(node.style, saved); delete node.dataset.motionPress; } },
  });
  return {
    motion,
    press(inside: boolean) {
      reduced = readPreferences().reducedMotion;
      node.dataset.motionPress = "";
      node.style.transform = "none";
      node.style.willChange = reduced ? "opacity" : "transform";
      motion.to(inside ? 0.96 : 1, { damping: 1, response: reduced ? 0.08 : 0.3 });
    },
    dispose() { motion.stop(); Object.assign(node.style, saved); delete node.dataset.motionPress; },
  };
}
/** Delegation includes controls mounted later and never consumes their action. */
export function installPressFeedback(doc: Document) {
  const controls = new Map<HTMLElement, ReturnType<typeof pressMotion>>();
  const pointers = new Map<number, HTMLElement>();
  let keyboard: HTMLElement | null = null;
  const find = (target: EventTarget | null) => {
    const node = target instanceof Element ? target.closest<HTMLElement>('button, a[href], [role="button"]') : null;
    return node && node.closest(pressScope) && !node.matches(':disabled, [aria-disabled="true"]') ? node : null;
  };
  const feedback = (node: HTMLElement, down: boolean) => {
    if (!node.isConnected) { controls.get(node)?.dispose(); controls.delete(node); return; }
    // Release disconnected controls without retaining their DOM indefinitely.
    for (const [element, control] of controls) if (!element.isConnected || (!control.motion.running && control.motion.target === 1)) {
      control.dispose(); controls.delete(element);
    }
    let control = controls.get(node);
    if (!control) { control = pressMotion(node); controls.set(node, control); }
    control.press(down);
  };
  const down = (event: PointerEvent) => {
    rememberMotionOrigin(event.target);
    if (event.button !== 0) return;
    const node = find(event.target);
    if (node) { pointers.set(event.pointerId, node); feedback(node, true); }
  };
  const move = (event: PointerEvent) => {
    const node = pointers.get(event.pointerId);
    if (!node) return;
    const rect = node.getBoundingClientRect();
    feedback(node, event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
  };
  const up = (event: PointerEvent) => {
    const node = pointers.get(event.pointerId);
    if (node) feedback(node, false);
    pointers.delete(event.pointerId);
  };
  const keydown = (event: KeyboardEvent) => {
    rememberMotionOrigin(event.target, true);
    if (event.repeat || (event.key !== " " && event.key !== "Enter")) return;
    keyboard = find(event.target);
    if (keyboard) feedback(keyboard, true);
  };
  const keyup = (event: KeyboardEvent) => {
    if (event.key !== " " && event.key !== "Enter") return;
    if (keyboard) feedback(keyboard, false);
    keyboard = null;
  };
  const reset = () => {
    pointers.forEach((node) => feedback(node, false)); pointers.clear();
    if (keyboard) feedback(keyboard, false); keyboard = null;
  };
  doc.addEventListener("pointerdown", down, true);
  doc.addEventListener("pointermove", move, true);
  doc.addEventListener("pointerup", up, true);
  doc.addEventListener("pointercancel", up, true);
  doc.addEventListener("keydown", keydown, true);
  doc.addEventListener("keyup", keyup, true);
  doc.defaultView?.addEventListener("blur", reset);
  return () => {
    doc.removeEventListener("pointerdown", down, true); doc.removeEventListener("pointermove", move, true);
    doc.removeEventListener("pointerup", up, true); doc.removeEventListener("pointercancel", up, true);
    doc.removeEventListener("keydown", keydown, true); doc.removeEventListener("keyup", keyup, true);
    doc.defaultView?.removeEventListener("blur", reset);
    controls.forEach((control) => control.dispose()); controls.clear(); pointers.clear();
  };
}
