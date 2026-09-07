"use client";
import { useLayoutEffect, useRef, useState, type HTMLAttributes, type RefObject } from "react";
import { spring, type FrameClock } from "./spring";
import { observePreferences, readPreferences } from "./preferences";
import { useSurfaceMotion } from "./react";

export interface Retained<T> { item: T; present: boolean }
export function retainItems<T extends { id: string }>(previous: Retained<T>[], items: readonly T[]): Retained<T>[] {
  const current: Retained<T>[] = items.map((item) => ({ item, present: true }));
  previous.forEach((entry, index) => {
    if (!items.some((item) => item.id === entry.item.id)) current.splice(Math.min(index, current.length), 0, { ...entry, present: false });
  });
  return current;
}
export function useRetainedTabs<T extends { id: string }>(items: readonly T[]) {
  const [state, setState] = useState({ source: items, entries: retainItems<T>([], items) });
  if (state.source !== items) setState({ source: items, entries: retainItems(state.entries, items) });
  return {
    entries: state.entries,
    remove: (id: string) => setState((current) => ({ ...current, entries: current.entries.filter((entry) => entry.present || entry.item.id !== id) })),
  };
}

/** Layout changes once. The independent presentation axes absorb that change. */
export function tabPosition(node: HTMLElement, clock?: FrameClock) {
  let x = 0, y = 0;
  const paint = () => { node.style.translate = `${x}px ${y}px`; };
  const rest = () => { if (!sx.running && !sy.running) node.style.willChange = ""; };
  const sx = spring(0, { clock, onUpdate: (value) => { x = value; paint(); }, onRest: rest });
  const sy = spring(0, { clock, onUpdate: (value) => { y = value; paint(); }, onRest: rest });
  const unsubscribe = observePreferences((prefs) => {
    if (prefs.reducedMotion) { sx.set(0); sy.set(0); node.style.willChange = ""; }
  });
  return {
    x: sx, y: sy,
    move(dx: number, dy: number) {
      if (readPreferences().reducedMotion) return;
      node.style.willChange = "transform";
      sx.set(sx.value + dx, sx.velocity); sy.set(sy.value + dy, sy.velocity);
      sx.to(0); sy.to(0);
    },
    dispose() { unsubscribe(); sx.stop(); sy.stop(); node.style.translate = ""; node.style.willChange = ""; },
  };
}
export function useTabLayout(ref: RefObject<HTMLDivElement | null>, version: unknown) {
  const positions = useRef(new Map<HTMLElement, { left: number; top: number; animation: ReturnType<typeof tabPosition> }>());
  useLayoutEffect(() => {
    const entries = positions.current;
    for (const [node, entry] of entries) if (!node.isConnected) { entry.animation.dispose(); entries.delete(node); }
    const nodes = ref.current?.querySelectorAll<HTMLElement>("[data-motion-tab]") ?? [];
    // All reads precede writes. offsetLeft/Top exclude the live transforms.
    const measured = Array.from(nodes, (node) => ({ node, left: node.offsetLeft, top: node.offsetTop }));
    for (const { node, left, top } of measured) {
      const old = entries.get(node);
      const animation = old?.animation ?? tabPosition(node);
      if (old && (old.left !== left || old.top !== top)) animation.move(old.left - left, old.top - top);
      entries.set(node, { left, top, animation });
    }
  }, [ref, version]);
  useLayoutEffect(() => {
    const entries = positions.current;
    return () => { entries.forEach((entry) => entry.animation.dispose()); entries.clear(); };
  }, []);
}
export function MotionTab({ shown, selected, onExited, activeRef, children, ...props }: HTMLAttributes<HTMLDivElement> & {
  shown: boolean; selected: boolean; onExited: () => void; activeRef?: RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLSpanElement>(null);
  const [initialSelection] = useState(selected);
  useSurfaceMotion(ref, shown, { skipInitial: true, material: false, onRest: (visible) => { if (!visible) onExited(); } });
  useSurfaceMotion(highlight, selected, { path: "fade", skipInitial: true, material: false });
  return <div {...props} ref={(node) => { ref.current = node; if (activeRef) activeRef.current = node; }}
    data-motion-tab="" inert={!shown} aria-hidden={!shown || undefined}>
    <span ref={highlight} className="motion-tab-highlight" style={{ opacity: initialSelection ? 1 : 0 }} aria-hidden="true" />
    {children}
  </div>;
}
