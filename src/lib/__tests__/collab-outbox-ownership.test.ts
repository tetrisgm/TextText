import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { applyDocumentBaseline, documentSnapshotFromYDoc, documentText } from "@/lib/collab/document";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { outboxIndexedDB } from "./helpers/outbox-indexeddb";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules();
});
async function settle() { for (let i = 0; i < 200; i++) await Promise.resolve(); }
const encode = (doc: Y.Doc) => Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
async function setup(postId: string) {
  vi.useFakeTimers();
  const storage = outboxIndexedDB(); vi.stubGlobal("indexedDB", storage.indexedDB);
  const baseline = new Y.Doc(), snapshot = emptyDocumentSnapshot();
  snapshot.content.body = "alpha";
  applyDocumentBaseline(baseline, snapshot, `${postId}:1`);
  const encoded = encode(baseline);
  baseline.destroy();
  const pushes: { body: { updates: string[] }; respond: (response: Response) => void }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") return new Promise<Response>((respond) => {
      pushes.push({ body: JSON.parse(String(init.body)), respond });
    });
    if (String(input).includes("wait=0")) return Response.json({
      updates: [], seq: 0, epoch: 5, baseline: { update: encoded, revision: 1 },
    });
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal("fetch", fetcher);
  async function tab() {
    vi.resetModules();
    const providerModule = await import("@/lib/collab/provider");
    const doc = new Y.Doc(), onRetired = vi.fn(), onError = vi.fn(), onRecovery = vi.fn();
    const provider = new providerModule.CollabProvider(doc, {
      postId, userName: "QA", color: "#000000", canPush: true, presence: false,
      onRetired, onError, onRecovery,
    });
    cleanups.push(() => { provider.destroy(); doc.destroy(); });
    await provider.start();
    return { module: providerModule, doc, provider, onRetired, onError, onRecovery };
  }
  return { tab, storage, pushes, fetcher };
}

it("reopens simultaneous producers with every edit and its remote reconstruction dependencies", async () => {
  const h = await setup("ownership-simultaneous"), a = await h.tab(), b = await h.tab();
  const peer = new Y.Doc(); Y.applyUpdate(peer, Y.encodeStateAsUpdate(a.doc));
  documentText(peer, "body").insert(5, " PEER");
  Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(peer), "collab-remote");
  documentText(a.doc, "body").insert(10, " EDIT A");
  documentText(b.doc, "body").insert(5, " EDIT B");
  await settle();
  a.provider.destroy(); b.provider.destroy(); peer.destroy();
  const reopened = await h.tab(), text = documentText(reopened.doc, "body").toString();
  expect(text).toContain("PEER EDIT A"); expect(text).toContain("EDIT B");
  expect(reopened.onRetired).not.toHaveBeenCalled();
});

it("acknowledges only the sent operations and retains another tab's dependent state after restart", async () => {
  const h = await setup("ownership-ack"), a = await h.tab(), b = await h.tab();
  documentText(a.doc, "body").insert(5, " A");
  await vi.advanceTimersByTimeAsync(300);
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), "collab-remote");
  documentText(b.doc, "body").insert(7, " B");
  await settle();
  h.pushes[0].respond(Response.json({ seq: 1, epoch: 5 })); await settle();
  a.provider.destroy(); b.provider.destroy();
  const reopened = await h.tab();
  expect(documentText(reopened.doc, "body").toString()).toBe("alpha A B");
  // The baseline retains A's identities, but only B still needs delivery.
  const row = h.storage.records.get("ownership-ack") as { updates: string[] };
  expect(row.updates).toHaveLength(1);
  expect(row.updates).not.toContain(h.pushes[0].body.updates[0]);
});

it.each([false, true])("retirement and recovery acknowledgment preserve another tab's same-epoch work (abort=%s)", async (abort) => {
  const postId = `ownership-retirement-${abort}`, h = await setup(postId);
  const a = await h.tab(), b = await h.tab();
  documentText(a.doc, "body").insert(5, " A");
  await vi.advanceTimersByTimeAsync(300);
  documentText(b.doc, "body").insert(5, " B"); await settle();
  if (abort) h.storage.failRetirement();
  h.pushes[0].respond(Response.json({ retired: true, epoch: 6 })); await settle();
  const recovery = await a.module.readRetiredOutboxes(postId);
  expect(recovery.durable).toBe(!abort);
  expect(recovery.copies[0].document?.content.body).toBe("alpha A");
  expect(await a.module.acknowledgeRetiredOutboxes(recovery.copies)).toBe(true);
  const row = h.storage.records.get(postId) as { baseline: string; updates: string[] };
  expect(row.updates).toHaveLength(1);
  const recovered = new Y.Doc();
  Y.applyUpdate(recovered, Buffer.from(row.baseline, "base64"));
  for (const update of row.updates) Y.applyUpdate(recovered, Buffer.from(update, "base64"));
  expect(documentText(recovered, "body").toString()).toContain(" B");
  recovered.destroy();
});

it.each(["epoch", "baseline"])("quarantines a writer instead of relabeling a conflicting durable %s", async (conflict) => {
  const postId = `ownership-conflict-${conflict}`, h = await setup(postId), a = await h.tab();
  const other = {
    postId, epoch: conflict === "epoch" ? 6 : 5, epochKnown: true,
    baselineRevision: conflict === "baseline" ? 2 : 1, updates: ["other generation"],
  };
  h.storage.records.set(postId, other);
  documentText(a.doc, "body").insert(5, " LOCAL"); await settle();
  expect(h.storage.records.get(postId)).toEqual(other);
  const recovery = await a.module.readRetiredOutboxes(postId);
  expect(recovery.copies[0].document?.content.body).toBe("alpha LOCAL");
  expect(a.provider.materializationBlocked).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.pushes).toHaveLength(0);
});

it.each([400, 413, 422])("quarantines all dependencies and in-flight edits on permanent rejection %s", async (status) => {
  const postId = `ownership-rejection-${status}`, h = await setup(postId), a = await h.tab();
  documentText(a.doc, "body").insert(5, "x".repeat(400_000));
  await vi.advanceTimersByTimeAsync(300);
  documentText(a.doc, "body").insert(documentText(a.doc, "body").length, " IN FLIGHT");
  h.pushes[0].respond(Response.json({ error: "Rejected" }, { status })); await settle();
  const expected = documentSnapshotFromYDoc(a.doc);
  expect(a.onRetired).toHaveBeenCalledExactlyOnceWith(5, "sync-rejected");
  expect(a.onError).toHaveBeenCalledWith(expect.stringContaining("Download your local copy"));
  expect(a.provider.materializationBlocked).toBe(true);
  expect(await a.provider.materialize("qa")).toBeNull();
  a.provider.enqueueCurrentState();
  documentText(a.doc, "body").insert(0, "AFTER STOP ");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.pushes).toHaveLength(1);
  const reopened = await h.tab();
  expect(reopened.onRecovery).toHaveBeenCalledOnce();
  const recovery = await reopened.module.readRetiredOutboxes(postId);
  expect(recovery.durable).toBe(true);
  expect(recovery.copies[0].document).toEqual(expected);
  expect(recovery.copies[0].reason).toBe("sync-rejected");
  const recovered = new Y.Doc();
  Y.applyUpdate(recovered, Buffer.from(recovery.copies[0].state, "base64"));
  expect(documentSnapshotFromYDoc(recovered)).toEqual(expected);
  recovered.destroy();
});

it("preserves an unreadable durable baseline and quarantines the new writer separately", async () => {
  const postId = "ownership-corrupt-baseline", h = await setup(postId);
  const a = await h.tab(), b = await h.tab();
  documentText(a.doc, "body").insert(5, " A"); await settle();
  const row = { ...(h.storage.records.get(postId) as object), baseline: "not base64!" };
  h.storage.records.set(postId, row);
  documentText(b.doc, "body").insert(5, " B"); await settle();
  expect(h.storage.records.get(postId)).toEqual(row);
  const recovery = await b.module.readRetiredOutboxes(postId);
  expect(recovery.durable).toBe(true);
  expect(recovery.copies[0].document?.content.body).toBe("alpha B");
  expect(b.provider.materializationBlocked).toBe(true);
});

it("hydrates and merges a legacy row without epochKnown", async () => {
  const postId = "ownership-legacy", h = await setup(postId), a = await h.tab();
  documentText(a.doc, "body").insert(5, " LEGACY"); await settle();
  const row = h.storage.records.get(postId) as Record<string, unknown>;
  delete row.epochKnown;
  a.provider.destroy();
  const reopened = await h.tab();
  documentText(reopened.doc, "body").insert(documentText(reopened.doc, "body").length, " NEW");
  await settle();
  expect(documentText(reopened.doc, "body").toString()).toBe("alpha LEGACY NEW");
  expect(reopened.onRetired).not.toHaveBeenCalled();
  expect(h.storage.records.get(postId)).toMatchObject({ epochKnown: true, epoch: 5 });
});

it.each(["stale revision", "missing revision", "unreadable pending"])(
  "keeps a restored baseline out of a differently seeded live doc (%s)", async (mode) => {
    const postId = `ownership-stale-${mode}`, h = await setup(postId), a = await h.tab();
    documentText(a.doc, "body").insert(5, " LOCAL"); await settle();
    a.provider.destroy();
    const row = h.storage.records.get(postId) as Record<string, unknown>;
    if (mode === "missing revision") row.baselineRevision = null;
    if (mode === "unreadable pending") row.updates = ["not base64!"];
    const replacement = new Y.Doc(), snapshot = emptyDocumentSnapshot();
    snapshot.content.body = "CURRENT";
    applyDocumentBaseline(replacement, snapshot, `${postId}:2`);
    const encoded = encode(replacement); replacement.destroy();
    h.fetcher.mockImplementation(async (input) => {
      if (String(input).includes("wait=0")) return Response.json({
        updates: [], seq: 0, epoch: 5, baseline: { update: encoded, revision: 2 },
      });
      return new Promise<Response>(() => {});
    });
    const reopened = await h.tab(); await settle();
    expect(reopened.provider.materializationBlocked).toBe(true);
    expect(documentText(reopened.doc, "body").toString()).toBe("");
    const recovery = await reopened.module.readRetiredOutboxes(postId);
    expect(recovery.durable).toBe(true);
    expect(recovery.copies[0].document?.content.body).toBe("alpha LOCAL");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.pushes).toHaveLength(0);
  },
);

it("keeps legacy unknown-epoch edits writable while catch-up is still in flight", async () => {
  const postId = "ownership-legacy-before-catchup", h = await setup(postId), a = await h.tab();
  documentText(a.doc, "body").insert(5, " LEGACY"); await settle();
  a.provider.destroy();
  const row = h.storage.records.get(postId) as Record<string, unknown>;
  delete row.epochKnown; row.epoch = 0;
  let respond!: (response: Response) => void;
  h.fetcher.mockImplementation(async () => new Promise<Response>((resolve) => { respond = resolve; }));
  vi.resetModules();
  const { CollabProvider } = await import("@/lib/collab/provider");
  const doc = new Y.Doc(); Y.applyUpdate(doc, Y.encodeStateAsUpdate(a.doc));
  const onRetired = vi.fn();
  const provider = new CollabProvider(doc, {
    postId, userName: "QA", color: "#000000", canPush: true, presence: false, onRetired,
  });
  cleanups.push(() => { provider.destroy(); doc.destroy(); });
  const starting = provider.start(); await settle();
  documentText(doc, "body").insert(documentText(doc, "body").length, " NEW"); await settle();
  expect(onRetired).not.toHaveBeenCalled();
  expect(provider.materializationBlocked).toBe(false);
  expect(h.storage.records.get(postId)).toMatchObject({ epoch: 0, epochKnown: false });
  expect((h.storage.records.get(postId) as { updates: string[] }).updates).toHaveLength(2);
  respond(Response.json({ updates: [], seq: 0, epoch: 5, baseline: { update: encode(a.doc), revision: 1 } }));
  await starting; await settle();
  expect(onRetired).not.toHaveBeenCalled();
  expect(documentText(doc, "body").toString()).toBe("alpha LEGACY NEW");
});
