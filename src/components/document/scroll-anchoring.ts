// Scroll anchoring for WebKit.
//
// When something above the visible region grows, an image finishing its
// load, an embed sizing itself, everything the reader is looking at moves
// down by that amount. Chromium's scroll anchoring compensates on its own;
// Older WebKit had none, and the Mac app runs WebKit, so scrolling up through an
// image-heavy document made the page jump with every image that landed.
// This observes the document's media and, whenever an element whose top is
// above the viewport changes height, moves the scroller by the difference.

import { useEffect, type RefObject } from "react";

const MEDIA = "img, video, iframe";

function scrollerFor(element: Element): HTMLElement | null {
  let node = element.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (
      /(auto|scroll)/.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function useAboveViewportGrowthAnchoring(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root || typeof ResizeObserver === "undefined") return;
    // Newer WebKit anchors on its own (overflow-anchor). Compensating as well
    // doubled every correction, which is what made scrolling up through a
    // loading article jump (owner, 2026-09-05). Only older engines need this.
    if (typeof CSS !== "undefined" && CSS.supports("overflow-anchor: auto")) return;
    const heights = new WeakMap<Element, number>();
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const height = entry.contentRect.height;
        const previous = heights.get(element);
        heights.set(element, height);
        if (previous === undefined) continue;
        const delta = height - previous;
        if (Math.abs(delta) < 0.5) continue;
        const scroller = scrollerFor(element);
        const top = element.getBoundingClientRect().top;
        const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
        // Only growth that starts above what the reader sees moves it.
        if (top >= viewTop) continue;
        (window as unknown as { __ttAnchor?: (d: number, e: Element) => void }).__ttAnchor?.(delta, element);
        if (scroller) scroller.scrollTop += delta;
        else window.scrollBy(0, delta);
      }
    });
    const observeAll = () => {
      for (const element of root.querySelectorAll(MEDIA)) observer.observe(element);
    };
    observeAll();
    const mutations = new MutationObserver(observeAll);
    mutations.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [ref, enabled]);
}
