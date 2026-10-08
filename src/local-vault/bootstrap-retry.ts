import { VaultError } from "./bridge";
export function isTransientBootstrapError(error: unknown): boolean {
  return error instanceof VaultError ? ["408", "429", "500", "502", "503", "504"].includes(error.code ?? "")
    : error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
}
export async function boundedBootstrapRead<T>(read: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const request = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    return await Promise.race([read(request.signal), new Promise<never>((_, reject) => {
      abort = () => { reject(signal.reason); request.abort(); };
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => { reject(new VaultError("The connection is taking longer than expected.", "408")); request.abort(); }, 8000);
      if (signal.aborted) abort();
    })]);
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
/** Reads only; bounded even if an underlying native/HTTP transport ignores cancellation. */
export async function retryBootstrap<T>(read: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await boundedBootstrapRead(read, signal); }
    catch (error) { if (!isTransientBootstrapError(error) || attempt >= 2 || signal.aborted) throw error; }
    await new Promise<void>((resolve, reject) => {
      const finish = () => { signal.removeEventListener("abort", cancel); resolve(); };
      const timer = setTimeout(finish, [300, 1000][attempt]);
      const cancel = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(signal.reason); };
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
}
