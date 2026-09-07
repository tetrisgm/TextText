import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CollabProvider, readRetiredOutboxes } from "@/lib/collab/provider";
import { createDocumentYDoc, documentSnapshotFromYDoc, documentText } from "@/lib/collab/document";
import { replaceSharedText } from "@/lib/collab/text-transactions";
import { MAX_UPDATE_CHARS } from "@/lib/collab/limits";
import { recoveryHeading } from "@/lib/collab/materialization-recovery";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { outboxIndexedDB } from "./helpers/outbox-indexeddb";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});
async function harness(postId: string) {
  vi.useFakeTimers();
  const storage = outboxIndexedDB(); vi.stubGlobal("indexedDB", storage.indexedDB);
  const server = createDocumentYDoc(emptyDocumentSnapshot());
  const baseline = Buffer.from(Y.encodeStateAsUpdate(server)).toString("base64");
  const batches: string[][] = [];
  let seq = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/presence")) return Response.json({ presence: [] });
    if (init?.method === "POST") {
      const { updates } = JSON.parse(String(init.body)) as { updates: string[] };
      batches.push(updates);
      if (updates.some((update) => update.length > MAX_UPDATE_CHARS)) return Response.json({ error: "Invalid Yjs update" }, { status: 400 });
      for (const update of updates) Y.applyUpdate(server, Buffer.from(update, "base64"));
      return Response.json({ seq: seq += updates.length, epoch: 1 });
    }
    if (url.includes("wait=0")) return Response.json({ updates: [], seq: 0, epoch: 1, baseline: { update: baseline, revision: 1 } });
    return new Promise<Response>(() => {});
  }));
  const doc = new Y.Doc(), retired = vi.fn();
  const provider = new CollabProvider(doc, { postId, userName: "Paste", color: "#000000", canPush: true, onRetired: retired });
  cleanups.push(() => { provider.destroy(); doc.destroy(); server.destroy(); });
  await provider.start();
  return { doc, server, provider, retired, batches, storage };
}

it("flushes a paste across multiple durable outbox batches without quarantine or duplication", async () => {
  const h = await harness("bounded-large-paste");
  const body = "x".repeat(5_000_000);
  replaceSharedText(documentText(h.doc, "body"), 0, 0, body, "paste");
  await vi.advanceTimersByTimeAsync(2_000);
  expect(h.batches.length).toBeGreaterThan(1); // More than the relay's 64 updates/request.
  for (const batch of h.batches) {
    expect(batch.length).toBeLessThanOrEqual(64);
    for (const update of batch) expect(update.length).toBeLessThan(MAX_UPDATE_CHARS);
  }
  expect(documentSnapshotFromYDoc(h.server).content.body).toBe(body);
  expect(h.retired).not.toHaveBeenCalled();
  expect(h.provider.materializationBlocked).toBe(false);
  expect((await readRetiredOutboxes("bounded-large-paste")).copies).toEqual([]);
  expect(h.storage.records.has("bounded-large-paste")).toBe(false);
});

it("still quarantines an unbounded raw update and preserves the complete local text with a truthful message", async () => {
  const h = await harness("unbounded-large-paste-backstop");
  const body = "x".repeat(600_000);
  documentText(h.doc, "body").insert(0, body); // Bypass the supported writer deliberately.
  await vi.advanceTimersByTimeAsync(2_000);
  const recovery = await readRetiredOutboxes("unbounded-large-paste-backstop");
  expect(recovery.durable).toBe(true);
  expect(recovery.copies).toHaveLength(1);
  expect(recovery.copies[0].reason).toBe("sync-rejected");
  expect(recovery.copies[0].document?.content.body).toBe(body);
  expect(recoveryHeading(recovery.copies)).toBe("These edits could not be synced");
  expect(h.provider.materializationBlocked).toBe(true);
  expect(documentSnapshotFromYDoc(h.server).content.body).toBe("");
  const count = h.batches.length;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(h.batches).toHaveLength(count);
});
