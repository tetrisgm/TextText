import { VaultError } from "./bridge";
import { boundedBootstrapRead } from "./bootstrap-retry";

/** One account lifetime: bounded backoff, deduplicated recovery events, no polling after success. */
export function loadAccountProfile<T>(options: {
  read: (signal: AbortSignal) => Promise<T>; signal: AbortSignal; events: EventTarget;
  loaded: (value: T) => void; failed: () => void;
}) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false, complete = false, attempts = 0, retryable = true, hasFailed = false;
  let ready: boolean | undefined, recoveryPending = false, lastRecovery = -Infinity;
  const delays = [1000, 3000, 10_000, 30_000, 60_000];
  const cancel = () => { controller.abort(); clearTimeout(timer); options.events.removeEventListener("online", recover); options.events.removeEventListener("offline", recover); options.events.removeEventListener("texttext:vault-sync-status", recover); };
  const schedule = (delay: number) => {
    if (controller.signal.aborted || complete || active || !retryable || attempts > delays.length) return;
    clearTimeout(timer); timer = setTimeout(() => { timer = undefined; void run(); }, delay);
  };
  const recover = (event: Event) => {
    let next: boolean;
    if (event.type === "online") next = true;
    else if (event.type === "offline") next = false;
    else {
      const detail = (event as CustomEvent).detail;
      if (typeof detail?.onlineReady !== "boolean") return;
      next = detail.available === true && detail.onlineReady;
    }
    const recovered = ready !== true && next;
    ready = next;
    if (!recovered || !hasFailed || controller.signal.aborted || complete || !retryable || Date.now() - lastRecovery < 10_000) return;
    lastRecovery = Date.now();
    if (active) { recoveryPending = true; return; }
    attempts = 0;
    schedule(1000); // Replace stale backoff only after a genuine reconnect.
  };
  const run = async () => {
    if (controller.signal.aborted || complete || active || attempts > delays.length) return;
    active = true; attempts++;
    try {
      const value = await boundedBootstrapRead(options.read, controller.signal);
      if (!controller.signal.aborted) { complete = true; options.loaded(value); cancel(); }
    } catch (error) {
      if (controller.signal.aborted) return;
      retryable = !(error instanceof VaultError && ["401", "403", "404", "unauthorized", "forbidden", "not_found"].includes(error.code ?? ""));
      hasFailed = true;
      options.failed();
    } finally {
      active = false;
      if (recoveryPending && !complete && retryable) { recoveryPending = false; attempts = 0; schedule(1000); }
      else if (!complete && retryable && attempts <= delays.length) schedule(delays[attempts - 1]);
    }
  };
  options.signal.addEventListener("abort", cancel, { once: true });
  options.events.addEventListener("online", recover);
  options.events.addEventListener("offline", recover);
  options.events.addEventListener("texttext:vault-sync-status", recover);
  if (options.signal.aborted) cancel(); else void run();
  return () => { options.signal.removeEventListener("abort", cancel); cancel(); };
}
