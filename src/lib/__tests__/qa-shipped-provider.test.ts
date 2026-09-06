import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CollabProvider } from "@/lib/collab/provider";
import { applyDocumentBaseline, documentSnapshotFromYDoc, documentText } from "@/lib/collab/document";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function tick() { for (let i = 0; i < 60; i++) await Promise.resolve(); }
it("F6: a poll body finishing after terminal access loss cannot mutate the stopped document", async () => {
  vi.useFakeTimers();
  const baseline = new Y.Doc(), doc = new Y.Doc();
  const snapshot = emptyDocumentSnapshot(); snapshot.content.body = "Original";
  applyDocumentBaseline(baseline, snapshot, "late-poll:1");
  const encoded = Buffer.from(Y.encodeStateAsUpdate(baseline)).toString("base64");
  let finishJson!: (body: unknown) => void;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/materialize")) return new Response(null, { status: 403 });
    if (url.includes("wait=0")) return Response.json({ updates: [], seq: 0, epoch: 1, baseline: { update: encoded, revision: 1 } });
    return { ok: true, status: 200, json: () => new Promise(resolve => { finishJson = resolve; }) } as Response;
  }));
  const lost = vi.fn();
  const provider = new CollabProvider(doc, { postId: "qa-late-poll", userName: "Editor", color: "#000000", canPush: true, presence: false, onAccessLost: lost });
  try {
    await provider.start(); await tick();
    expect(finishJson).toBeTypeOf("function");
    documentText(doc, "body").insert(8, " local text");
    expect((await provider.materialize("writer"))?.status).toBe(403);
    expect(lost).toHaveBeenCalledOnce(); expect(provider.materializationBlocked).toBe(true);
    const frozen = documentSnapshotFromYDoc(doc).content.body;
    const peer = new Y.Doc(); Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    documentText(peer, "body").insert(0, "LATE REMOTE ");
    finishJson({ updates: [{ seq: 1, update: Buffer.from(Y.encodeStateAsUpdate(peer)).toString("base64") }], seq: 1, epoch: 1 });
    await tick(); peer.destroy();
    expect(documentSnapshotFromYDoc(doc).content.body).toBe(frozen);
  } finally { provider.destroy(); doc.destroy(); baseline.destroy(); }
});
