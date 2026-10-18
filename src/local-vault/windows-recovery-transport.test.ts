import { afterEach, expect, it, vi } from "vitest";
import { createWindowsVaultTransport } from "./windows-transport";

afterEach(() => vi.unstubAllGlobals());
function native(handler: (method: string, params: Record<string, unknown>) => unknown) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const messages: { id: string; method: string; params: Record<string, unknown> }[] = [];
  return { messages,
    addEventListener: (_: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MessageEvent) => void) => listeners.delete(listener),
    postMessage(value: unknown) {
      const message = value as typeof messages[number]; messages.push(message);
      void Promise.resolve().then(() => handler(message.method, message.params)).then(
        result => { for (const listener of listeners) listener({ data: { id: message.id, result } } as MessageEvent); },
        error => { for (const listener of listeners) listener({ data: { id: message.id, error: { message: error.message } } } as MessageEvent); });
    },
  };
}
const status = { root: "C:\\Bound", workspaceId: "workspace", name: "Workspace", accountId: "account-a", available: true, connected: true };
const replacement = { id: "operation", path: "Moved.textpack", itemId: "item", currentHash: "a".repeat(64), preparedHash: "b".repeat(64), displacedHash: "c".repeat(64), savedAt: "2026-10-18" };

it.each([false, true])("keeps bound local recovery available with hosted history offline=%s", async offline => {
  vi.stubGlobal("window", new EventTarget());
  const view = native((method, params) => {
    if (method === "native.status") return status;
    if (method === "files.replacementList") { expect(params.workspaceRoot).toBe(status.root); return [replacement]; }
    if (method === "files.recoveryAssets") return { assets: [{ id: "asset", filename: "submitted.asset", byteLength: 3, hash: "d".repeat(64), savedAt: "2026-10-18" }], assetsTruncated: true };
    if (method === "native.http") {
      if (offline) throw new Error("Offline");
      return { status: 200, headers: { "Content-Type": "application/json" }, body: btoa(JSON.stringify({ entries: [{ id: "server-copy" }], truncated: false })) };
    }
    throw new Error(method);
  });
  const transport = await createWindowsVaultTransport(view);
  try {
    const result = await transport.request("recoveryList", { workspaceRoot: "C:\\Untrusted" }) as Record<string, unknown>;
    expect(result).toMatchObject({ replacements: [replacement], assetsTruncated: true });
    expect(result.entries).toEqual(offline ? [] : [{ id: "server-copy" }]);
    expect(Boolean(result.warning)).toBe(offline);
  } finally { transport.destroy(); }
});

it("surfaces a corrupt native registry before requesting server recovery", async () => {
  vi.stubGlobal("window", new EventTarget());
  const view = native(method => {
    if (method === "native.status") return status;
    if (method === "files.replacementList") throw new Error("Recovery registry is corrupt");
    throw new Error("Unexpected " + method);
  });
  const transport = await createWindowsVaultTransport(view);
  try {
    await expect(transport.request("recoveryList", {})).rejects.toThrow("Recovery registry is corrupt");
    expect(view.messages.some(message => message.method === "native.http")).toBe(false);
  } finally { transport.destroy(); }
});

it("returns opaque displaced bytes and binds explicit resolution and raw downloads to the captured root", async () => {
  vi.stubGlobal("window", new EventTarget());
  const retained = { opaque: true, path: "Moved.textpack", hash: "c".repeat(64), data: btoa("not a ZIP"), parseError: "Retained file" };
  const view = native((method, params) => {
    if (method === "native.status") return status;
    expect(params.workspaceRoot).toBe(status.root);
    if (method === "files.replacementRead") return retained;
    if (method === "files.resolveReplacement") return { resolved: true };
    if (method === "files.recoveryAssetRead") return { filename: "submitted.asset", hash: "d".repeat(64), byteLength: 3, data: "AQID" };
    throw new Error(method);
  });
  const transport = await createWindowsVaultTransport(view);
  try {
    expect(await transport.request("replacementRead", { id: "operation", version: "displaced", workspaceRoot: "other" })).toEqual(retained);
    expect(await transport.request("resolveReplacement", { ...replacement, workspaceRoot: "other" })).toEqual({ resolved: true });
    expect(await transport.request("recoveryAssetRead", { id: "asset", hash: "d".repeat(64), workspaceRoot: "other" })).toMatchObject({ data: "AQID", byteLength: 3 });
  } finally { transport.destroy(); }
});

it("returns explicit removal absence without parsing a fabricated empty pack", async () => {
  vi.stubGlobal("window", new EventTarget());
  const absent = { absent: true, path: "Removed.textpack", hash: null, data: null };
  const view = native(method => {
    if (method === "native.status") return status;
    if (method === "files.replacementRead") return absent;
    throw new Error(method);
  });
  const transport = await createWindowsVaultTransport(view);
  try {
    expect(await transport.request("replacementRead", { id: "removed", version: "current" })).toEqual(absent);
    await expect(transport.request("replacementRead", { id: "removed", version: "prepared" })).rejects.toThrow("Invalid local recovery response");
  } finally { transport.destroy(); }
});
