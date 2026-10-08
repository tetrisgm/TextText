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
