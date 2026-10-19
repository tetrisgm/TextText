import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { UnifiedDocumentEditorProps } from "@/components/document/UnifiedDocumentEditor";
vi.mock("@/components/document/UnifiedDocumentEditor", () => ({ UnifiedDocumentEditor: () => null }));
import { VaultEditorSurfaceHost } from "./editor-surface-host";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const props = () => { const doc = new Y.Doc(), awareness = new Awareness(doc); return { doc, awareness, value: { localDocument: doc, localPresence: { awareness, peers: [] } } as unknown as UnifiedDocumentEditorProps, close() { awareness.destroy(); doc.destroy(); } }; };
describe("single mounted vault surface ownership", () => {
  it("does not temporarily unregister the active surface during a controller props update", async () => {
    const host = new VaultEditorSurfaceHost(), first = props(), next = { ...first.value };
    host.register("local", first.value); host.unregister("local", first.value); host.register("local", next);
    await Promise.resolve(); expect(host.current()).toBe(next); first.close();
  });
  it("switches document and all callback props in the synchronous commit", () => {
    const host = new VaultEditorSurfaceHost(), local = props(), shared = props(), bind = vi.fn(async () => {});
    host.register("local", local.value); host.register("shared", shared.value); host.registerRebind(bind);
    expect(host.commitShared()).toBe(true); expect(bind).toHaveBeenCalledWith(shared.doc, shared.awareness); expect(host.current()).toBe(shared.value);
    local.close(); shared.close();
  });
  it("refuses a commit without a real local rebind and shared awareness", () => {
    const host = new VaultEditorSurfaceHost(), shared = props(); host.register("shared", shared.value);
    expect(host.commitShared()).toBe(false); shared.close();
  });
  it("bounds unavailable shared surfaces and aborts a superseded wait", async () => {
    vi.useFakeTimers(); const host = new VaultEditorSurfaceHost(), controller = new AbortController();
    const wait = host.waitForSharedSurface(controller.signal); const rejected = expect(wait).rejects.toThrow("cancelled"); controller.abort(); await rejected;
    const expired = host.waitForSharedSurface(new AbortController().signal), refused = expect(expired).rejects.toThrow("did not become ready"); await vi.advanceTimersByTimeAsync(20_000); await refused;
  });
  it("waits for composition completion and its final input frame without waiting for blur", async () => {
    vi.useFakeTimers(); vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    const host = new VaultEditorSurfaceHost(); host.setComposing(true); let completed = false;
    const wait = host.waitForComposition(new AbortController().signal).then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(100); expect(completed).toBe(false);
    host.setComposing(false); await vi.advanceTimersByTimeAsync(15); expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await wait; expect(completed).toBe(true);
  });
});
