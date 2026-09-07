"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { captureMotionOrigin, type MotionOrigin } from "./origin";
import { surfaceMotion, type MotionSnapshot } from "./surface";

/** Keeps the real subtree through exit. Reopening retargets that same spring. */
export function useMotionPresence(open: boolean) {
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  const latest = useRef(open);
  useLayoutEffect(() => { latest.current = open; }, [open]);
  const onRest = useCallback((shown: boolean) => { if (!shown && !latest.current) setPresent(false); }, []);
  return { present: open || present, onRest };
}
export function useSurfaceMotion(ref: RefObject<HTMLElement | null>, open: boolean, options: {
  origin?: RefObject<MotionOrigin | null>; path?: "scale" | "rail" | "sheet" | "fade"; material?: boolean; skipInitial?: boolean;
  onRest?: (shown: boolean) => void; mounted?: boolean; snapshot?: RefObject<MotionSnapshot | null>;
} = {}) {
  const control = useRef<ReturnType<typeof surfaceMotion> | null>(null);
  const latest = useRef(options.onRest);
  useLayoutEffect(() => { latest.current = options.onRest; });
  const latestOpen = useRef(open);
  useLayoutEffect(() => { latestOpen.current = open; }, [open]);
  const mounted = options.mounted ?? true;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !mounted) return;
    const origin = options.origin ? options.origin.current : captureMotionOrigin() ?? (node.ownerDocument.activeElement as HTMLElement | null);
    const animation = surfaceMotion(node, {
      path: options.path, material: options.material, origin, initial: options.snapshot?.current?.value ?? (options.skipInitial && latestOpen.current ? 1 : 0),
      velocity: options.snapshot?.current?.velocity,
      onUpdate: (value) => { if (options.snapshot) options.snapshot.current = value; },
      onRest: (shown) => latest.current?.(shown),
    });
    control.current = animation;
    return () => { animation.dispose(); control.current = null; };
  }, [ref, mounted, options.origin, options.path, options.snapshot, options.material, options.skipInitial]);
  useLayoutEffect(() => { control.current?.show(open, options.origin?.current); }, [open, mounted, options.origin, options.path, options.material, options.skipInitial]);
  return control;
}

/** Logical closure releases interaction while the presentation finishes its spring. */
export function useExitMotion(ref: RefObject<HTMLElement | null>, onClose: () => void, options: {
  mounted?: boolean; visible?: boolean; origin?: RefObject<MotionOrigin | null>; identity?: unknown;
} = {}) {
  const [open, setOpen] = useState(true);
  const [identity, setIdentity] = useState(options.identity);
  if (identity !== options.identity) { setIdentity(options.identity); setOpen(true); }
  const logicalOpen = open && (options.visible ?? true);
  const close = useCallback(() => setOpen(false), []);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.inert = !logicalOpen;
    ref.current.setAttribute("aria-hidden", String(!logicalOpen));
  }, [ref, logicalOpen, options.mounted]);
  useSurfaceMotion(ref, logicalOpen, { ...options, onRest: (shown) => { if (!shown) onClose(); } });
  return Object.assign(close, { open: logicalOpen, closing: !logicalOpen });
}
