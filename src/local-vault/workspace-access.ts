import { boundedBootstrapRead } from "./bootstrap-retry";
import { parseVaultAccess, type VaultAccess } from "./shared-vaults";

/** One captured account/workspace lifetime. Refresh only on existing activity
 * events; an offline or replaced read can never restore controls. */
export function watchWorkspaceAccess(options: {
  read: (signal: AbortSignal) => Promise<unknown>;
  events: EventTarget;
  changed: (value: VaultAccess | null) => void;
  failed?: (error: unknown) => void;
}) {
  let stopped = false, queued = false, followup = false, offline = false, generation = 0;
  let current: AbortController | null = null;
  const refresh = (event?: Event) => {
    if (event?.type === "online" || event?.type === "texttext:vault-sync-status" && (event as CustomEvent).detail?.onlineReady === true) offline = false;
    if (stopped || offline) return;
    // Ordinary activity keeps the same principal/scope. Do not cancel a slow
    // authenticated read on every sync notification and starve its result.
    if (current) { followup = true; return; }
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (stopped || offline) return;
      const captured = generation;
      const controller = new AbortController(); current = controller;
      void boundedBootstrapRead(options.read, controller.signal).then(value => {
        if (!stopped && captured === generation && !controller.signal.aborted) options.changed(parseVaultAccess(value));
      }).catch(error => {
        if (!stopped && captured === generation && !controller.signal.aborted) { options.changed(null); options.failed?.(error); }
      }).finally(() => {
        if (current !== controller) return;
        current = null;
        if (followup) { followup = false; refresh(); }
      });
    });
  };
  const wentOffline = () => {
    if (stopped) return;
    offline = true; generation++; followup = false;
    current?.abort(); current = null;
    options.changed(null);
  };
  const events = ["focus", "online", "texttext:vault-changed", "texttext:vault-sync-status"];
  for (const event of events) options.events.addEventListener(event, refresh);
  options.events.addEventListener("offline", wentOffline);
  refresh();
  return () => {
    stopped = true; generation++; current?.abort(); current = null;
    for (const event of events) options.events.removeEventListener(event, refresh);
    options.events.removeEventListener("offline", wentOffline);
  };
}
