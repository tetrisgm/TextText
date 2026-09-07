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


it.each([401,403,410])("R12: reopened recovery does not invent an external edit after access loss %s", async status => {
  const postId = `round12-access-${status}`, h = await setup(postId), a = await h.tab();
  documentText(a.doc, "body").insert(5, " LOCAL");
  await vi.advanceTimersByTimeAsync(300);
  // A detached editor has no transient accessLoss heading or localStorage callback.
  a.provider.destroy();
  h.pushes[0].respond(Response.json({ error: "Access denied" }, { status })); await settle();
  const b = await h.tab();
  const recovery = await b.module.readRetiredOutboxes(postId);
  expect(recovery.durable).toBe(true);
  expect(recovery.copies[0].document?.content.body).toBe("alpha LOCAL");
  const { recoveryHeading } = await import("@/lib/collab/materialization-recovery");
  expect(recoveryHeading(recovery.copies)).not.toBe("This document changed elsewhere");
});
