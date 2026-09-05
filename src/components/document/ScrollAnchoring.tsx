"use client";

// Installs WebKit scroll anchoring on the document it is rendered inside.
// DocumentRenderer also renders on the server, so the effect lives here.

import { useEffect, useRef } from "react";
import { useAboveViewportGrowthAnchoring } from "@/components/document/scroll-anchoring";

export function ScrollAnchoring() {
  const marker = useRef<HTMLSpanElement | null>(null);
  const root = useRef<HTMLElement | null>(null);
  useEffect(() => {
    root.current = marker.current?.closest<HTMLElement>(".tt-document") ?? null;
  }, []);
  useAboveViewportGrowthAnchoring(root);
  return <span ref={marker} hidden aria-hidden="true" />;
}
