import { afterEach, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("cancels a native collaboration request and ignores its late reply", async () => {
  vi.resetModules(); vi.useFakeTimers();
  const sent: { id: string; method: string; params: Record<string, unknown> }[] = [];
  const surface = Object.assign(new EventTarget(), { webkit: { messageHandlers: { localVault: { postMessage: (body: typeof sent[number]) => sent.push(body) } } } });
  vi.stubGlobal("window", surface);
  const { vaultRequest } = await import("./bridge");
  const abort = new AbortController();
  const pending = vaultRequest("collaborationRead", { itemId: "item-1", waitMs: 25000 }, abort.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  abort.abort(); await rejected;
  expect(sent.map(value => value.method)).toEqual(["collaborationRead", "collaborationCancel"]);
  expect(sent[1].params.requestId).toBe(sent[0].id);
  surface.dispatchEvent(new CustomEvent("texttext:vault-reply", { detail: { id: sent[0].id, result: { update: "late" } } }));
  expect(vi.getTimerCount()).toBe(0);
});
it("passes cancellation to web requests without adding native pending timers", async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal("window", new EventTarget());
  const { vaultRequest, setVaultTransport } = await import("./bridge");
  const abort = new AbortController();
  const request = vi.fn(async () => ({ ok: true }));
  const release = setVaultTransport(request);
  expect(await vaultRequest("collaborationRead", { itemId: "item" }, abort.signal)).toEqual({ ok: true });
  expect(request).toHaveBeenCalledWith("collaborationRead", { itemId: "item" }, abort.signal);
  expect(vi.getTimerCount()).toBe(0); release();
});
