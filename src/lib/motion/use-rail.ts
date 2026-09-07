"use client";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { railResize, type RailPointer } from "./rail";

export function useRailResize(ref: RefObject<HTMLElement | null>, width: number, min: number, max: number, commit: (width: number) => void) {
  const control = useRef<ReturnType<typeof railResize> | null>(null);
  const latest = useRef(commit);
  useLayoutEffect(() => { latest.current = commit; });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const animation = railResize(ref.current, { width, min, max, commit: (value) => latest.current(value) });
    control.current = animation;
    return () => { animation.dispose(); control.current = null; };
    // Initial geometry is captured once; changes are synchronized below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  useLayoutEffect(() => { control.current?.sync(width, min, max); }, [width, min, max]);
  return {
    onPointerDown: (event: RailPointer) => control.current?.down(event),
    onPointerMove: (event: RailPointer) => control.current?.move(event),
    onPointerUp: (event: RailPointer) => control.current?.up(event),
    onPointerCancel: (event: RailPointer) => control.current?.cancel(event),
    onLostPointerCapture: (event: RailPointer) => control.current?.cancel(event),
    keyboard: (value: number | ((target: number) => number)) => control.current?.keyboard(value),
  };
}
