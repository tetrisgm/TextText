export type MotionOrigin = Pick<HTMLElement, "getBoundingClientRect">;
let origin: MotionOrigin | null = null;
/** Snapshot only at pointer-down/key-down; animation frames never read layout. */
export function rememberMotionOrigin(target: EventTarget | null, keyboard = false) {
  const node = target instanceof Element ? target.closest<HTMLElement>('button, a[href], [role="button"], [role="menuitem"]') : null;
  if (!node || (keyboard && !node.matches("button, a[href], [role=button], [role=menuitem]"))) { origin = null; return; }
  const rect = node.getBoundingClientRect();
  origin = { getBoundingClientRect: () => rect };
}
export function captureMotionOrigin(): MotionOrigin | null { return origin; }
