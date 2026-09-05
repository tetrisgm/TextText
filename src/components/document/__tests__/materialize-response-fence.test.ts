import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  applyDocumentSnapshot,
  documentSnapshotFromYDoc,
  documentText,
  hasDocumentSnapshot,
} from "@/lib/collab/document";
import { validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";

// Execute the production callbacks, including their queue/idle waits and Yjs
// listener. A copied version comparison missed remote-update suppression in
// the previous regression. This harness supplies hook refs without mounting
// React; it makes no claim about browser input or painting.
const editor = readFileSync(new URL("../UnifiedDocumentEditor.tsx", import.meta.url), "utf8");
function section(start: string, end: string) {
  const from = editor.indexOf(start);
  const to = editor.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Editor callback not found: ${start}`);
  return editor.slice(from, to);
}
const source = [
  section("function replaceYText(", "\nfunction selectionForField("),
  section("  const flushMaterialization = useCallback(", "\n  useEffect(() => {"),
  section("    const handleDocumentUpdate =", '    doc.on("update", handleDocumentUpdate);'),
].join("\n");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const snapshotOf = (body: string) => validateDocumentSnapshot({
  schemaVersion: 1,
  content: { title: "Race", body, fields: {}, tags: [], assets: [] },
  presentation: { template: { id: "texttext.note", version: 1 }, theme: {} },
});
const BODY = "alpha DELETE omega";
const bodyOf = (doc: Y.Doc) => documentSnapshotFromYDoc(doc).content.body;
const cleanups: (() => void)[] = [];
async function tick() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function harness({ pending = true, idle = false } = {}) {
  const doc = new Y.Doc();
  applyDocumentSnapshot(doc, snapshotOf(BODY), "baseline");
  cleanups.push(() => doc.destroy());
  let visible = snapshotOf(BODY);
  let dirty = pending;
  const refs = {
    documentMutationVersionRef: { current: 0 },
    localMaterializationVersionRef: { current: pending ? 1 : 0 },
    savedMaterializationVersionRef: { current: 0 },
    materializeTimerRef: { current: null },
    materializeQueueRef: { current: Promise.resolve() },
    localOrigin: { current: Symbol("local") },
    userEditOrigin: { current: Symbol("user") },
    undoManagerRef: { current: {} },
    readyRef: { current: true },
    preReadyLocalRef: { current: null as DocumentSnapshot | null },
  };
  const requests: {
    document: DocumentSnapshot;
    keepalive: boolean;
    resolve: (value: unknown) => void;
  }[] = [];
  const idleCallbacks: (() => void)[] = [];
  const publishDocument = vi.fn((next: DocumentSnapshot) => { visible = next; dirty = true; });
  const onMaterialized = vi.fn(() => { dirty = false; });
  const setSaveState = vi.fn();
  const setError = vi.fn();
  const bindings = {
    ...refs, doc, Y, hasDocumentSnapshot, documentSnapshotFromYDoc, applyDocumentSnapshot,
    useCallback: (callback: unknown) => callback,
    networkEnabled: true, collab: { canEdit: true, postId: "probe" }, blog: { handle: "probe" },
    publishDocument, onMaterialized, setSaveState, setError,
    navigator: { onLine: true },
    bytesToBase64: (bytes: Uint8Array) => Buffer.from(bytes).toString("base64"),
    requestIdleCallback: idle ? (callback: () => void) => { idleCallbacks.push(callback); } : undefined,
    fetch: (_url: string, options: { body: string; keepalive: boolean }) => {
      const encoded = JSON.parse(options.body).state;
      const sent = new Y.Doc();
      Y.applyUpdate(sent, Buffer.from(encoded, "base64"));
      const document = documentSnapshotFromYDoc(sent);
      sent.destroy();
      return new Promise((resolve) => { requests.push({ document, keepalive: options.keepalive, resolve }); });
    },
  };
  // The merged editor asks the provider to materialize; the provider encodes
  // the state and sends the learned epoch. Route it through the fetch stub so
  // the harness still sees the sent document.
  Object.assign(bindings as Record<string, unknown>, {
    recoveryBlockedRef: { current: false },
    providerRef: {
      current: {
        materializationBlocked: false,
        materialize: (handle: string, keepalive: boolean) =>
          (bindings as unknown as { fetch: (url: string, options: { body: string; keepalive: boolean }) => Promise<unknown> }).fetch(
            "/materialize",
            { body: JSON.stringify({ handle, state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64") }), keepalive },
          ),
      },
    },
  });
  const runtime = new Function(...Object.keys(bindings), `${compiled}\nreturn { flushMaterialization, scheduleMaterialization, handleDocumentUpdate, replaceYText };`)(...Object.values(bindings)) as {
    flushMaterialization: (keepalive?: boolean) => Promise<void>;
    scheduleMaterialization: () => void;
    handleDocumentUpdate: (update: Uint8Array, origin: unknown) => void;
    replaceYText: (text: Y.Text, value: string, origin: unknown) => void;
  };
  doc.on("update", runtime.handleDocumentUpdate);
  return {
    ...runtime, doc, refs, requests, idleCallbacks, publishDocument, onMaterialized, setSaveState, setError,
    visible: () => visible.content.body,
    dirty: () => dirty,
    remote(change: (peer: Y.Doc) => void) {
      const peer = new Y.Doc();
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
      change(peer);
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer), "collab-remote");
      peer.destroy();
    },
    type(value: string) {
      publishDocument({ ...visible, content: { ...visible.content, body: value } });
      runtime.replaceYText(documentText(doc, "body"), value, refs.userEditOrigin.current);
    },
    respond(index: number, result: unknown = { document: requests[index].document, revision: index + 2 }, ok = true) {
      requests[index].resolve({ ok, json: async () => result });
    },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("materialization visibility and response fencing", () => {
  it("publishes a remote deletion during a save and persists the merge after rejecting its stale response", async () => {
    const h = harness();
    const first = h.flushMaterialization();
    await tick();
    h.remote((peer) => documentText(peer, "body").delete(6, 7));
    expect(h.visible()).toBe("alpha omega");
    expect(bodyOf(h.doc)).toBe("alpha omega");
    expect(h.dirty()).toBe(true);
    h.respond(0);
    await first;
    expect(bodyOf(h.doc)).toBe("alpha omega");
    expect(h.onMaterialized).not.toHaveBeenCalled();
    expect(h.setSaveState).toHaveBeenLastCalledWith("local");
    expect(h.refs.localMaterializationVersionRef.current).toBeGreaterThan(h.refs.savedMaterializationVersionRef.current);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1].document.content.body).toBe("alpha omega");
    h.respond(1);
    await h.refs.materializeQueueRef.current;
    expect(h.onMaterialized).toHaveBeenCalledExactlyOnceWith(h.requests[1].document, 3);
    expect(h.dirty()).toBe(false);
    expect(h.setSaveState).toHaveBeenLastCalledWith("saved");
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.requests).toHaveLength(2); // accepted responses never save themselves
  });

  it("keeps a remote insertion when the person next types from the visible body", async () => {
    const h = harness();
    const first = h.flushMaterialization();
    await tick();
    h.remote((peer) => documentText(peer, "body").insert(0, "REMOTE "));
    expect(h.visible()).toBe(`REMOTE ${BODY}`);
    h.type(`${h.visible()}!`);
    expect(bodyOf(h.doc)).toBe(`REMOTE ${BODY}!`);
    h.respond(0);
    await first;
    expect(bodyOf(h.doc)).toBe(`REMOTE ${BODY}!`);
    expect(h.onMaterialized).not.toHaveBeenCalled();
  });

  it("accepts a current server snapshot without scheduling a save of the acknowledgment", async () => {
    const h = harness();
    const first = h.flushMaterialization();
    await tick();
    const result = snapshotOf(`${BODY} SERVER`);
    h.respond(0, { document: result, revision: 7 });
    await first;
    expect(bodyOf(h.doc)).toBe(`${BODY} SERVER`);
    expect(h.visible()).toBe(`${BODY} SERVER`);
    expect(h.publishDocument).toHaveBeenCalledTimes(1);
    expect(h.onMaterialized).toHaveBeenCalledExactlyOnceWith(result, 7);
    expect(h.dirty()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("publishes remote metadata and rejects an older full-document acknowledgment", async () => {
    const h = harness();
    const first = h.flushMaterialization();
    await tick();
    h.remote((peer) => {
      const next = documentSnapshotFromYDoc(peer);
      next.content.tags = ["remote"];
      applyDocumentSnapshot(peer, next, "remote-tags");
    });
    expect(h.publishDocument.mock.lastCall?.[0].content.tags).toEqual(["remote"]);
    h.respond(0);
    await first;
    expect(documentSnapshotFromYDoc(h.doc).content.tags).toEqual(["remote"]);
    expect(h.onMaterialized).not.toHaveBeenCalled();
  });

  it("still fences a local deletion while the response is in flight", async () => {
    const h = harness();
    const first = h.flushMaterialization();
    await tick();
    h.type("alpha omega");
    h.respond(0);
    await first;
    expect(bodyOf(h.doc)).toBe("alpha omega");
    expect(h.onMaterialized).not.toHaveBeenCalled();
  });

  it("fences every queued request independently across successive remote merges", async () => {
    const h = harness();
    const first = h.flushMaterialization();
    await tick();
    const second = h.flushMaterialization(); // queued while generation 0 is in flight
    h.remote((peer) => documentText(peer, "body").delete(6, 7));
    h.respond(0);
    await first;
    await tick();
    expect(h.requests[1].document.content.body).toBe("alpha omega");
    h.remote((peer) => documentText(peer, "body").insert(0, "REMOTE "));
    h.respond(1);
    await second;
    expect(h.visible()).toBe("REMOTE alpha omega");
    expect(bodyOf(h.doc)).toBe("REMOTE alpha omega");
    expect(h.onMaterialized).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.requests).toHaveLength(3);
    h.respond(2);
    await h.refs.materializeQueueRef.current;
    expect(h.onMaterialized).toHaveBeenCalledExactlyOnceWith(h.requests[2].document, 4);
    expect(h.refs.savedMaterializationVersionRef.current).toBe(h.refs.localMaterializationVersionRef.current);
  });

  it("captures the fence after idle time and skips already acknowledged queued work", async () => {
    const h = harness({ idle: true });
    const first = h.flushMaterialization();
    const second = h.flushMaterialization();
    await tick();
    expect(h.requests).toHaveLength(0);
    h.remote((peer) => documentText(peer, "body").delete(6, 7));
    h.idleCallbacks.shift()!();
    await tick();
    expect(h.requests[0].document.content.body).toBe("alpha omega");
    h.respond(0);
    await first;
    await tick();
    h.idleCallbacks.shift()!();
    await tick();
    expect(h.requests).toHaveLength(1);
    await second;
    expect(h.onMaterialized).toHaveBeenCalledTimes(1);
    expect(h.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.requests).toHaveLength(1);
  });

  it("invalidates a response even if the changed CRDT projects the same text again", async () => {
    const h = harness();
    const first = h.flushMaterialization();
    await tick();
    h.remote((peer) => {
      documentText(peer, "body").delete(6, 7);
      documentText(peer, "body").insert(6, "DELETE ");
    });
    expect(bodyOf(h.doc)).toBe(BODY);
    h.respond(0);
    await first;
    expect(h.onMaterialized).not.toHaveBeenCalled();
  });

  it("counts remote generations even without local dirty work", () => {
    const h = harness({ pending: false });
    h.remote((peer) => documentText(peer, "body").insert(0, "REMOTE "));
    expect(h.visible()).toBe(`REMOTE ${BODY}`);
    expect(h.refs.documentMutationVersionRef.current).toBe(1);
    expect(h.refs.localMaterializationVersionRef.current).toBe(0);
    expect(h.onMaterialized).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the pre-ready ledger while keeping a remote merge pending", async () => {
    const h = harness();
    const first = h.flushMaterialization();
    await tick();
    h.refs.readyRef.current = false;
    h.refs.preReadyLocalRef.current = snapshotOf("alpha omega");
    h.remote((peer) => documentText(peer, "body").insert(0, "REMOTE "));
    expect(h.publishDocument).not.toHaveBeenCalled();
    expect(h.refs.preReadyLocalRef.current.content.body).toBe("alpha omega");
    expect(h.refs.documentMutationVersionRef.current).toBe(1);
    h.respond(0);
    await first;
    expect(bodyOf(h.doc)).toBe(`REMOTE ${BODY}`);
    expect(h.onMaterialized).not.toHaveBeenCalled();
    expect(h.refs.localMaterializationVersionRef.current).toBeGreaterThan(h.refs.savedMaterializationVersionRef.current);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("publishes undo and schedules its persistence during a save", async () => {
    const h = harness();
    const first = h.flushMaterialization();
    await tick();
    h.doc.transact(() => documentText(h.doc, "body").delete(6, 7), h.refs.undoManagerRef.current);
    expect(h.visible()).toBe("alpha omega");
    h.respond(0);
    await first;
    expect(h.onMaterialized).not.toHaveBeenCalled();
    expect(h.setSaveState).toHaveBeenLastCalledWith("local");
  });

  it("does not acknowledge a superseded response without a persisted snapshot", async () => {
    const h = harness();
    const first = h.flushMaterialization();
    await tick();
    h.respond(0, { ok: true, skipped: "superseded" });
    await first;
    expect(h.onMaterialized).not.toHaveBeenCalled();
    expect(h.refs.savedMaterializationVersionRef.current).toBe(0);
    expect(h.dirty()).toBe(true);
    expect(h.setSaveState).toHaveBeenLastCalledWith("error");
  });

  it("keeps the merge pending after failure and allows a keepalive retry", async () => {
    const h = harness();
    const first = h.flushMaterialization();
    await tick();
    h.remote((peer) => documentText(peer, "body").delete(6, 7));
    h.respond(0, {}, false);
    await first;
    expect(h.refs.savedMaterializationVersionRef.current).toBe(0);
    expect(h.visible()).toBe("alpha omega");
    const retry = h.flushMaterialization(true);
    await tick();
    expect(h.requests[1].keepalive).toBe(true);
    expect(h.requests[1].document.content.body).toBe("alpha omega");
    h.respond(1);
    await retry;
    expect(h.dirty()).toBe(false);
    expect(h.setSaveState).toHaveBeenLastCalledWith("saved");
  });
});
