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
it("ignores a late native search reply after its query is cancelled", async () => {
  vi.resetModules(); vi.useFakeTimers();
  const sent: { id: string; method: string; params: Record<string, unknown> }[] = [];
  const surface = Object.assign(new EventTarget(), { webkit: { messageHandlers: { localVault: { postMessage: (body: typeof sent[number]) => sent.push(body) } } } });
  vi.stubGlobal("window", surface);
  const { vaultRequest } = await import("./bridge");
  const abort = new AbortController();
  const pending = vaultRequest("search", { query: "old query" }, abort.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  abort.abort(); await rejected;
  surface.dispatchEvent(new CustomEvent("texttext:vault-reply", { detail: { id: sent[0].id, result: { items: [{ path: "stale" }] } } }));
  expect(sent.map(value => value.method)).toEqual(["search"]);
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

it("starts an import timeout only after the user finishes the native picker", async () => {
  vi.resetModules(); vi.useFakeTimers();
  const sent: { id: string; method: string; params: Record<string, unknown> }[] = [];
  const surface = Object.assign(new EventTarget(), { webkit: { messageHandlers: { localVault: { postMessage: (body: typeof sent[number]) => sent.push(body) } } } });
  vi.stubGlobal("window", surface);
  const { vaultRequest } = await import("./bridge");
  const pending = vaultRequest("import", { folder: "Notes" });

  expect(vi.getTimerCount()).toBe(1);
  surface.dispatchEvent(new CustomEvent("texttext:vault-picker-open", { detail: { id: sent[0].id } }));
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(121_000);
  expect(vi.getTimerCount()).toBe(0);
  surface.dispatchEvent(new CustomEvent("texttext:vault-operation-start", { detail: { id: sent[0].id } }));
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(119_000);
  surface.dispatchEvent(new CustomEvent("texttext:vault-reply", {
    detail: { id: sent[0].id, result: { file: { path: "Notes/Imported.textpack" } } },
  }));
  await expect(pending).resolves.toEqual({ file: { path: "Notes/Imported.textpack" } });
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves native import-picker cancellation after an arbitrarily long wait", async () => {
  vi.resetModules(); vi.useFakeTimers();
  const sent: { id: string; method: string; params: Record<string, unknown> }[] = [];
  const surface = Object.assign(new EventTarget(), { webkit: { messageHandlers: { localVault: { postMessage: (body: typeof sent[number]) => sent.push(body) } } } });
  vi.stubGlobal("window", surface);
  const { vaultRequest } = await import("./bridge");
  const pending = vaultRequest("import", { folder: "Notes" });

  surface.dispatchEvent(new CustomEvent("texttext:vault-picker-open", { detail: { id: sent[0].id } }));
  await vi.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);
  surface.dispatchEvent(new CustomEvent("texttext:vault-reply", { detail: { id: sent[0].id, result: {} } }));
  await expect(pending).resolves.toEqual({});
  expect(vi.getTimerCount()).toBe(0);
});

it("starts the open-folder operation timeout after the native folder picker returns", async () => {
  vi.resetModules(); vi.useFakeTimers();
  const sent: { id: string; method: string; params: Record<string, unknown> }[] = [];
  const surface = Object.assign(new EventTarget(), { webkit: { messageHandlers: { localVault: { postMessage: (body: typeof sent[number]) => sent.push(body) } } } });
  vi.stubGlobal("window", surface);
  const { vaultRequest } = await import("./bridge");
  const pending = vaultRequest("open");

  surface.dispatchEvent(new CustomEvent("texttext:vault-picker-open", { detail: { id: sent[0].id } }));
  await vi.advanceTimersByTimeAsync(121_000);
  expect(vi.getTimerCount()).toBe(0);
  surface.dispatchEvent(new CustomEvent("texttext:vault-operation-start", { detail: { id: sent[0].id } }));
  expect(vi.getTimerCount()).toBe(1);
  surface.dispatchEvent(new CustomEvent("texttext:vault-reply", {
    detail: { id: sent[0].id, result: { root: "/tmp/selected", items: [] } },
  }));
  await expect(pending).resolves.toEqual({ root: "/tmp/selected", items: [] });
  expect(vi.getTimerCount()).toBe(0);
});

it("reports native import errors after picker selection and retains the operation timeout", async () => {
  vi.resetModules(); vi.useFakeTimers();
  const sent: { id: string; method: string; params: Record<string, unknown> }[] = [];
  const surface = Object.assign(new EventTarget(), { webkit: { messageHandlers: { localVault: { postMessage: (body: typeof sent[number]) => sent.push(body) } } } });
  vi.stubGlobal("window", surface);
  const { vaultRequest } = await import("./bridge");
  const pending = vaultRequest("import", { folder: "Notes" });
  const rejected = expect(pending).rejects.toMatchObject({ message: "The selected file is not a valid TextPack." });

  surface.dispatchEvent(new CustomEvent("texttext:vault-picker-open", { detail: { id: sent[0].id } }));
  await vi.advanceTimersByTimeAsync(121_000);
  surface.dispatchEvent(new CustomEvent("texttext:vault-operation-start", { detail: { id: sent[0].id } }));
  expect(vi.getTimerCount()).toBe(1);
  surface.dispatchEvent(new CustomEvent("texttext:vault-reply", {
    detail: { id: sent[0].id, error: { code: "file-error", message: "The selected file is not a valid TextPack." } },
  }));
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it("times out a selected import only after 120 seconds of native work", async () => {
  vi.resetModules(); vi.useFakeTimers();
  const sent: { id: string; method: string; params: Record<string, unknown> }[] = [];
  const surface = Object.assign(new EventTarget(), { webkit: { messageHandlers: { localVault: { postMessage: (body: typeof sent[number]) => sent.push(body) } } } });
  vi.stubGlobal("window", surface);
  const { vaultRequest } = await import("./bridge");
  const pending = vaultRequest("import", { folder: "Notes" });
  const rejected = expect(pending).rejects.toThrow("The file operation did not finish. Your text is still in the editor.");

  surface.dispatchEvent(new CustomEvent("texttext:vault-picker-open", { detail: { id: sent[0].id } }));
  await vi.advanceTimersByTimeAsync(121_000);
  surface.dispatchEvent(new CustomEvent("texttext:vault-operation-start", { detail: { id: sent[0].id } }));
  await vi.advanceTimersByTimeAsync(119_999);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the regular timeout on bridge calls that do not open a native picker", async () => {
  vi.resetModules(); vi.useFakeTimers();
  const sent: { id: string; method: string; params: Record<string, unknown> }[] = [];
  const surface = Object.assign(new EventTarget(), { webkit: { messageHandlers: { localVault: { postMessage: (body: typeof sent[number]) => sent.push(body) } } } });
  vi.stubGlobal("window", surface);
  const { vaultRequest } = await import("./bridge");
  const pending = vaultRequest("read", { path: "Notes/Existing.textpack" });
  const rejected = expect(pending).rejects.toThrow("The file operation did not finish. Your text is still in the editor.");

  await vi.advanceTimersByTimeAsync(120_000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
