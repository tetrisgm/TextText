export type VaultItem = { path: string; title?: string; itemId?: string };
export type VaultListing = { root: string; name?: string; folders?: string[]; items: VaultItem[] };
export type VaultFile = {
  path: string; hash: string; markdown: string;
  documentJSON?: string | null; templateJSON?: string | null;
  templateAuthoringSourceJSON?: string | null;
  assets?: { filename: string; contentType: string; data: string; remoteURL?: string }[];
};
export class VaultError extends Error {
  constructor(message: string, public code?: string, public current?: VaultFile) { super(message); }
}
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; cleanup: () => void }>();
if (typeof window !== "undefined") window.addEventListener("texttext:vault-reply", ((event: CustomEvent) => {
  const { id, result, error } = event.detail;
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  clearTimeout(request.timer);
  request.cleanup();
  if (error) request.reject(new VaultError(typeof error === "string" ? error : error.message, error.code, error.current));
  else request.resolve(result);
}) as EventListener);
export type VaultTransport = (method: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
let fallbackTransport: VaultTransport | null = null;
export function setVaultTransport(transport: VaultTransport) {
  fallbackTransport = transport;
  return () => { if (fallbackTransport === transport) fallbackTransport = null; };
}
export function vaultRequest<T>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Request canceled", "AbortError")); return; }
    const id = crypto.randomUUID();
    const bridge = (window as unknown as { webkit?: { messageHandlers?: { localVault?: { postMessage: (body: unknown) => void } } } }).webkit?.messageHandlers?.localVault;
    if (!bridge) {
      if (fallbackTransport) { void fallbackTransport(method, params, signal).then((value) => resolve(value as T), reject); return; }
      reject(new Error("Open this workspace in the TextText Mac app.")); return;
    }
    const cancelNative = () => {
      if (method === "collaborationRead" || method === "collaborationPush" || method.startsWith("presence") || method.startsWith("comments") || method.startsWith("feed")) {
        try { bridge.postMessage({ id: crypto.randomUUID(), method: "collaborationCancel", params: { requestId: id } }); } catch { /* The window may already be closed. */ }
      }
    };
    const abort = () => {
      if (!pending.delete(id)) return;
      clearTimeout(timer); cleanup(); cancelNative();
      reject(new DOMException("Request canceled", "AbortError"));
    };
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timer = setTimeout(() => { pending.delete(id); cleanup(); cancelNative(); reject(new Error("The file operation did not finish. Your text is still in the editor.")); }, 120_000);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer, cleanup });
    signal?.addEventListener("abort", abort, { once: true });
    try { bridge.postMessage({ id, method, params }); }
    catch (error) { clearTimeout(timer); pending.delete(id); cleanup(); reject(error); }
  });
}
