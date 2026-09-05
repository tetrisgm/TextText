// Schedule work for after the cold path has finished.
//
// requestIdleCallback fires while the pool fetch is still pending, so
// "idle" prefetches downloaded and parsed before the list was visible and
// the chunk split saved nothing. This waits for the window load event, then
// a quiet period, then an idle slot. Returns a cancel function.
export function scheduleAfterLoadIdle(
  fn: () => void,
  quietMs = 2500,
): () => void {
  if (typeof window === "undefined") return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idle: number | null = null;
  const settle = () => {
    timer = null;
    if ("requestIdleCallback" in window) idle = window.requestIdleCallback(fn);
    else fn();
  };
  const arm = () => {
    timer = globalThis.setTimeout(settle, quietMs);
  };
  if (document.readyState === "complete") arm();
  else window.addEventListener("load", arm, { once: true });
  return () => {
    window.removeEventListener("load", arm);
    if (timer !== null) globalThis.clearTimeout(timer);
    if (idle !== null) window.cancelIdleCallback(idle);
  };
}
