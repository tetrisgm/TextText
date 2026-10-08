/** Owns one long poll and resumes after an aborted poll has actually settled. */
export function watchWebWorkspace({ visible, wait, refresh, changed }: {
  visible: () => boolean;
  wait: (signal: AbortSignal) => Promise<boolean>;
  refresh: () => Promise<boolean>;
  changed: () => void;
}) {
  let stopped = false;
  let active: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let refreshing = false;
  const live = () => !stopped && visible();
  const listen = () => {
    if (!live() || active || retry) return;
    const controller = new AbortController();
    active = controller;
    void (async () => {
      let failed = false;
      try {
        while (live() && !controller.signal.aborted) {
          const updated = await wait(controller.signal);
          if (updated && live() && !controller.signal.aborted) changed();
        }
      } catch { failed = !controller.signal.aborted; }
      finally {
        if (active === controller) active = null;
        // A new online/visible event may precede the aborted request's rejection.
        // Restart here as well, without ever overlapping the old request.
        if (live()) retry = setTimeout(() => { retry = null; listen(); }, failed ? 5000 : 0);
      }
    })();
  };
  const visibilityChanged = () => {
    if (!live()) {
      active?.abort();
      if (retry) clearTimeout(retry);
      retry = null;
      return;
    }
    if (!refreshing) {
      refreshing = true;
      void refresh().then(updated => { if (updated && live()) changed(); })
        .catch(() => {}).finally(() => { refreshing = false; });
    }
    listen();
  };
  listen();
  return {
    visibilityChanged,
    dispose() { stopped = true; active?.abort(); if (retry) clearTimeout(retry); retry = null; },
  };
}
