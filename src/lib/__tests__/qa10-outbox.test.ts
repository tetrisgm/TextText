import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { applyDocumentBaseline, documentText, documentSnapshotFromYDoc } from "@/lib/collab/document";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { outboxIndexedDB } from "./helpers/outbox-indexeddb";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules();
});
const encode = (doc: Y.Doc) => Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
async function settle() { for (let i = 0; i < 100; i++) await Promise.resolve(); }
function baseline(postId: string) {
  const doc = new Y.Doc(), snapshot = emptyDocumentSnapshot();
  snapshot.content.body = "alpha";
  applyDocumentBaseline(doc, snapshot, `${postId}:1`);
  cleanups.push(() => doc.destroy());
  return doc;
}

it("QA10: a valid oversized paste and its dependent edits remain recoverable after relay rejection", async () => {
  vi.useFakeTimers();
  const storage = outboxIndexedDB(); vi.stubGlobal("indexedDB", storage.indexedDB);
  const { CollabProvider, readRetiredOutboxes } = await import("@/lib/collab/provider");
  const postId = "qa10-oversized", server = baseline(postId), encoded = encode(server);
  let rejected = 0, accepted = 0;
  let reject!: (response: Response) => void;
  const rejection = new Promise<Response>((resolve) => { reject = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const { updates } = JSON.parse(String(init.body)) as { updates: string[] };
      // The actual relay's per-update limit. All updates here are real Yjs.
      if (updates.some((update) => update.length > 512 * 1024)) {
        rejected++; return rejection;
      }
      for (const update of updates) Y.applyUpdate(server, Buffer.from(update, "base64"));
      accepted++; return Response.json({ seq: accepted, epoch: 0 });
    }
    if (String(input).includes("wait=0")) return Response.json({ updates: [], seq: 0, epoch: 0, baseline: { update: encoded, revision: 1 } });
    return new Promise<Response>(() => {});
  }));
  const doc = new Y.Doc();
  const provider = new CollabProvider(doc, { postId, userName: "QA", color: "#000000", canPush: true, presence: false });
  cleanups.push(() => { provider.destroy(); doc.destroy(); });
  await provider.start();
  documentText(doc, "body").insert(5, "x".repeat(400_000));
  await vi.advanceTimersByTimeAsync(300);
  // The relay has refused the upload, but the response has not reached the
  // editor yet. Typing remains possible until onRetired freezes the surface.
  documentText(doc, "body").insert(documentText(doc, "body").length, " TYPED AFTER REJECTION");
  reject(Response.json({ error: "Invalid update payload" }, { status: 400 }));
  await vi.advanceTimersByTimeAsync(300);
  expect(rejected).toBe(1); expect(accepted).toBe(0);
  expect(documentText(server, "body").toString()).toBe("alpha");
  provider.destroy(); await settle();
  // Emulate closing without a successful materialization. Neither live memory
  // nor an error toast is durable recovery after the process exits.
  const recovery = await readRetiredOutboxes(postId);
  expect(recovery.durable).toBe(true);
  expect(recovery.copies).toHaveLength(1);
  expect(recovery.copies[0].document?.content.body.endsWith(" TYPED AFTER REJECTION")).toBe(true);
});

it.each(["pending write", "successful acknowledgment"])("QA10: another tab's durable edit survives a %s", async (mode) => {
  vi.useFakeTimers();
  const storage = outboxIndexedDB(); vi.stubGlobal("indexedDB", storage.indexedDB);
  const postId = `qa10-tabs-${mode}`, server = baseline(postId), encoded = encode(server);
  let acknowledge!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => { acknowledge = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") return response;
    if (String(input).includes("wait=0")) return Response.json({ updates: [], seq: 0, epoch: 0, baseline: { update: encoded, revision: 1 } });
    return new Promise<Response>(() => {});
  }));
  // Separate module instances model separate tabs sharing one origin's IDB.
  const first = await import("@/lib/collab/provider");
  vi.resetModules();
  const second = await import("@/lib/collab/provider");
  const a = new Y.Doc(), b = new Y.Doc();
  const options = { postId, userName: "QA", color: "#000000", canPush: true, presence: false };
  const pa = new first.CollabProvider(a, options), pb = new second.CollabProvider(b, options);
  cleanups.push(() => { pa.destroy(); pb.destroy(); a.destroy(); b.destroy(); });
  await pa.start(); await pb.start();
  documentText(a, "body").insert(5, " TAB A UNSENT");
  await settle();
  expect(storage.records.has(postId)).toBe(true);
  if (mode === "pending write") {
    documentText(b, "body").insert(5, " TAB B UNSENT"); await settle();
  } else {
    await vi.advanceTimersByTimeAsync(300); // A's push is now in flight.
    documentText(b, "body").insert(5, " TAB B UNSENT"); await settle();
    acknowledge(Response.json({ seq: 1, epoch: 0 })); await settle();
  }
  const records = [...storage.records.values()] as { baseline?: string; updates?: string[] }[];
  const recovered = new Y.Doc(); Y.applyUpdate(recovered, Buffer.from(encoded, "base64"));
  for (const record of records) for (const update of [record.baseline, ...(record.updates ?? [])]) {
    if (update) Y.applyUpdate(recovered, Buffer.from(update, "base64"));
  }
  const text = documentSnapshotFromYDoc(recovered).content.body; recovered.destroy();
  expect(text).toContain(mode === "pending write" ? "TAB A UNSENT" : "TAB B UNSENT");
});
