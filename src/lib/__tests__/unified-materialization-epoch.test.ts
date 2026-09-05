import { readFileSync } from "node:fs";
import ts from "typescript";
import * as Y from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDocumentSnapshot, documentSnapshotFromYDoc, hasDocumentSnapshot } from "@/lib/collab/document";
import { emptyDocumentSnapshot } from "@/lib/documents/model";

// Execute the editor's real queued callback with hook refs. This isolates the
// acknowledgment boundary without claiming a mounted/browser interaction test.
const source = readFileSync(new URL("../../components/document/UnifiedDocumentEditor.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const flushMaterialization = useCallback(");
const end = source.indexOf("  const scheduleMaterialization = useCallback(", start);
function editorFlush(bindings: Record<string, unknown>): (keepalive?: boolean) => Promise<void> {
  const js = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return flushMaterialization;`)(...Object.values(bindings));
}

afterEach(() => vi.unstubAllGlobals());

describe("editor materialization retirement", () => {
  it.each([[false, 409, false], [true, 409, false], [false, 200, false], [false, 200, true]] as const)("keeps a retired live doc (keepalive %s, status %s, retirement during body %s)", async (keepalive, status, duringBody) => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("requestIdleCallback", undefined);
    const doc = new Y.Doc();
    const local = emptyDocumentSnapshot();
    local.content.body = "Unacknowledged local words";
    applyDocumentSnapshot(doc, local);
    const recoveryBlockedRef = { current: false };
    const savedMaterializationVersionRef = { current: 0 };
    let finish!: (response: Response) => void;
    const provider = { materializationBlocked: false, materialize: vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })) };
    const onMaterialized = vi.fn();
    const publishDocument = vi.fn();
    const flush = editorFlush({
      useCallback: (fn: unknown) => fn,
      networkEnabled: true, collab: { canEdit: true, postId: "post" }, blog: { handle: "demo" },
      doc, Y, hasDocumentSnapshot, applyDocumentSnapshot,
      recoveryBlockedRef, providerRef: { current: provider },
      materializeTimerRef: { current: null }, materializeQueueRef: { current: Promise.resolve() },
      localMaterializationVersionRef: { current: 1 }, savedMaterializationVersionRef,
      documentMutationVersionRef: { current: 0 },
      setSaveState: vi.fn(), setError: vi.fn(), publishDocument, onMaterialized,
    });
    const first = flush(keepalive);
    const queued = flush(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(provider.materialize).toHaveBeenCalledWith("demo", keepalive);
    let finishBody: ((value: unknown) => void) | undefined;
    if (duringBody) {
      const response = new Response(null, { status });
      response.json = () => new Promise((resolve) => { finishBody = resolve; });
      finish(response);
      await Promise.resolve();
      await Promise.resolve();
      expect(finishBody).toBeDefined();
    }
    recoveryBlockedRef.current = true;
    provider.materializationBlocked = true;
    if (finishBody) finishBody({ document: emptyDocumentSnapshot(), revision: 99 });
    else finish(new Response(JSON.stringify({ retired: true }), { status }));
    await first;
    await queued;
    expect(provider.materialize).toHaveBeenCalledOnce();
    expect(savedMaterializationVersionRef.current).toBe(0);
    expect(onMaterialized).not.toHaveBeenCalled();
    expect(publishDocument).not.toHaveBeenCalled();
    expect(documentSnapshotFromYDoc(doc)).toEqual(local);
    doc.destroy();
  });

  it("exposes explicit recovery before the editable surface and preserves copies across reopen", () => {
    expect(source.indexOf("if (recoveryCopies.length)")).toBeLessThan(source.indexOf("if (baselineFailure &&"));
    expect(source).toContain("readMaterializationRecoveries(collab.postId)");
    expect(source).toContain("keepMaterializationRecovery(copy)");
    expect(source).toContain("onRetired: preserveRecovery");
    expect(source).toContain("Download local copy");
    expect(source).toContain("disabled={!recoveryDownloaded}");
  });
});
