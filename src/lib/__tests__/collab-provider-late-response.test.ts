import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CollabProvider } from "@/lib/collab/provider";
import { applyDocumentBaseline, documentText } from "@/lib/collab/document";
import { emptyDocumentSnapshot } from "@/lib/documents/model";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function tick() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
function baseline() {
  const doc = new Y.Doc();
  const snapshot = emptyDocumentSnapshot(); snapshot.content.body = "Original";
  applyDocumentBaseline(doc, snapshot, "late-response:1");
  const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  doc.destroy();
  return { updates: [], seq: 0, epoch: 1, baseline: { update, revision: 1 } };
}

it.each(["response", "body"])("ignores catch-up %s completing after teardown", async stage => {
  vi.useFakeTimers();
  const data = baseline();
  let finish!: () => void;
  const response = { ok: true, status: 200, json: () => stage === "body"
    ? new Promise(resolve => { finish = () => resolve(data); }) : Promise.resolve(data) } as Response;
  vi.stubGlobal("fetch", vi.fn(() => stage === "response"
    ? new Promise<Response>(resolve => { finish = () => resolve(response); }) : Promise.resolve(response)));
  const doc = new Y.Doc();
  const provider = new CollabProvider(doc, { postId: `late-catchup-${stage}`, userName: "Reader", color: "#000000", canPush: false, presence: false });
  try {
    const started = provider.start(); await tick();
    expect(finish).toBeTypeOf("function");
    provider.destroy();
    const frozen = Y.encodeStateAsUpdate(doc);
    finish();
    expect(await started).toMatchObject({ authoritative: false });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(frozen);
    expect(provider.learnedEpoch).toBeNull();
  } finally { provider.destroy(); doc.destroy(); }
});

it("ignores a successful poll body from the network generation before hide and resume", async () => {
  vi.useFakeTimers();
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", page);
  const data = baseline();
  const bodies: Array<(body: unknown) => void> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("wait=0")
    ? Response.json(data)
    : { ok: true, status: 200, json: () => new Promise(resolve => bodies.push(resolve)) } as Response));
  const doc = new Y.Doc(), peer = new Y.Doc();
  const provider = new CollabProvider(doc, { postId: "late-obsolete-poll", userName: "Reader", color: "#000000", canPush: false, presence: false });
  try {
    await provider.start(); await tick();
    expect(bodies).toHaveLength(1);
    page.visibilityState = "hidden"; page.dispatchEvent(new Event("visibilitychange"));
    page.visibilityState = "visible"; page.dispatchEvent(new Event("visibilitychange"));
    await tick();
    expect(bodies).toHaveLength(2);
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    documentText(peer, "body").insert(0, "Obsolete ");
    bodies[0]({ ...data, epoch: 99, seq: 1, updates: [{ seq: 1, update: Buffer.from(Y.encodeStateAsUpdate(peer)).toString("base64") }] });
    await tick();
    expect(documentText(doc, "body").toString()).toBe("Original");
    expect(provider.learnedEpoch).toBe(1);
    expect(provider.materializationBlocked).toBe(false);
    bodies[1](data); await tick();
  } finally { provider.destroy(); doc.destroy(); peer.destroy(); }
});
