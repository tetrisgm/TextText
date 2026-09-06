/** One request at a time, only while visible. No background job survives cleanup. */
export function startVisiblePoll(
  read: (signal: AbortSignal) => Promise<void>,
  intervalMs = 15_000,
) {
  let stopped = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
  const refresh = async () => {
    clearTimeout(timer);
    if (stopped || pending || !visible()) return;
    pending = true;
    controller = new AbortController();
    try {
      await read(controller.signal);
    } finally {
      pending = false;
      if (!stopped && visible()) timer = setTimeout(() => void refresh(), intervalMs);
    }
  };
  const onVisibility = () => {
    clearTimeout(timer);
    if (!visible()) controller?.abort();
    else void refresh();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  void refresh();
  return {
    refresh,
    stop() {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
