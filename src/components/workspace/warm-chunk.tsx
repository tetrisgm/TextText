"use client";

import nextDynamic from "next/dynamic";
import type { ComponentType } from "react";

/**
 * A code-split component that stops suspending once its chunk is in memory.
 *
 * `React.lazy`, which `next/dynamic` is built on, suspends on its FIRST
 * render whatever else has happened. Preloading the chunk does not change
 * that: the import resolves in a microtask, and the render that asked for it
 * has already suspended by then. The navigation that mounts it commits
 * synchronously, so React has no choice but to commit the fallback, and
 * React then holds that fallback for its throttle of about 300ms rather than
 * flashing it away. The person watches an empty pane for a third of a second
 * for a chunk that was sitting in memory the whole time. It happens exactly
 * once per page load per chunk, which is why the second folder anyone opens
 * takes 25ms and the first took 470.
 *
 * So once the warm import has resolved, render the component itself. Nothing
 * suspends, nothing is thrown, no fallback is committed, and there is nothing
 * for the throttle to hold. Before it resolves this is the ordinary lazy
 * component, so a chunk that has not been warmed still behaves as it always
 * did.
 */
export function warmChunk<P extends object>(load: () => Promise<ComponentType<P>>): {
  /** Render this. It is the real component as soon as the chunk is in. */
  Component: ComponentType<P>;
  /** Fetch the chunk. Call it whenever there is nothing better to do. */
  warm: () => void;
} {
  let ready: ComponentType<P> | null = null;
  let warming: Promise<unknown> | null = null;
  const Lazy = nextDynamic(load, { ssr: false }) as unknown as ComponentType<P>;

  const warm = () => {
    if (ready || warming) return;
    warming = load()
      .then((component) => {
        ready = component;
      })
      .catch(() => {
        // The lazy component asks again and reports the failure itself.
        warming = null;
      });
  };

  function Warmed(props: P) {
    const Ready = ready;
    return Ready ? <Ready {...props} /> : <Lazy {...props} />;
  }
  Warmed.displayName = "Warmed";

  return { Component: Warmed as ComponentType<P>, warm };
}
