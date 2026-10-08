/** State shared across server bundles; plain engine/CLI imports never install signal handlers. */
const key = Symbol.for("texttext.read-poll-drain");
type State = { controller: AbortController; installed: boolean };
function state(): State {
  const shared = globalThis as typeof globalThis & { [key: symbol]: State | undefined };
  return shared[key] ??= { controller: new AbortController(), installed: false };
}
/** Called only by Next's server instrumentation lifecycle. Next owns exit and write draining. */
export function installReadDrain(): void {
  const current = state();
  if (current.installed) return;
  current.installed = true;
  const drain = () => current.controller.abort();
  process.once("SIGTERM", drain);
  process.once("SIGINT", drain);
}
export function readDrainSignal(): AbortSignal { return state().controller.signal; }
export function readRequestSignal(request?: AbortSignal): AbortSignal {
  return AbortSignal.any([readDrainSignal(), ...(request ? [request] : [])]);
}
/** Interrupt only read waits. Mutations retain their normal durable completion. */
export function waitForReadPoll(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}
