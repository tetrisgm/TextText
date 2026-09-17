import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { applyDocumentBaseline, documentText } from "@/lib/collab/document";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { outboxIndexedDB } from "./helpers/outbox-indexeddb";

/**
 * The note that lost its text.
 *
 * A person typed several lines, and all but the first two words vanished. The
 * cause was not an overwrite: a successful autosave rebuilt the collaboration
 * session, the rebuilt session fenced its own queued keystroke against the
 * canonical post revision (a number that diverges from the collaborative
 * baseline revision the moment anything materializes), read the mismatch as
 * "this device was offline with foreign edits", and stopped the only writer.
 * The editor kept accepting text that nothing persisted, and the session died
 * without leaving the recovery copy its own message promised.
 *
 * These tests hold that shut from both sides: a session rebuilt while an edit
 * is queued must keep writing, and any path that does stop a writer must
 * preserve what it holds.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function settle() {
  for (let index = 0; index < 200; index += 1) await Promise.resolve();
}

const encode = (doc: Y.Doc) => Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");

/**
 * A relay whose baseline revision stays at the revision the document was
 * created with, which is exactly what the server does: materializing advances
 * posts.revision while collab_state.baseline_revision keeps its own number.
 */
async function setup(postId: string, baselineRevision = 1) {
  let currentBaselineRevision = baselineRevision;
  vi.useFakeTimers();
  const storage = outboxIndexedDB();
  vi.stubGlobal("indexedDB", storage.indexedDB);
  const encodeBaseline = (revision: number) => {
    const baseline = new Y.Doc();
    const snapshot = emptyDocumentSnapshot();
    snapshot.content.body = "I truly";
    applyDocumentBaseline(baseline, snapshot, `${postId}:${revision}`);
    const encoded = encode(baseline);
    baseline.destroy();
    return encoded;
  };
  const encoded = encodeBaseline(baselineRevision);

  const pushes: { body: { updates: string[] }; respond: (response: Response) => void }[] = [];
  let seq = 0;
  /** Acknowledge everything in flight, as the relay does. */
  async function ack() {
    for (const push of pushes.splice(0)) {
      seq += 1;
      push.respond(Response.json({ seq, epoch: 5 }));
    }
    await settle();
  }
  const sent: string[] = [];
  const catchUps: number[] = [];
  let holdCatchUp = false;
  let releaseCatchUp: (() => void) | null = null;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { updates: string[] };
      sent.push(...body.updates);
      return new Promise<Response>((respond) => {
        pushes.push({ body, respond });
      });
    }
    if (String(input).includes("wait=0")) {
      const payload = {
        updates: [], seq: 0, epoch: 5,
        baseline: { update: encoded, revision: currentBaselineRevision },
      };
      if (!holdCatchUp) return Response.json(payload);
      // Held open so a keystroke can queue before the baseline lands, which is
      // the window the incident happened in.
      return new Promise<Response>((resolve) => {
        releaseCatchUp = () => resolve(Response.json(payload));
      });
    }
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal("fetch", fetcher);

  /** One editor session, built exactly as the editor builds it. */
  async function session(doc: Y.Doc) {
    const providerModule = await import("@/lib/collab/provider");
    const onRetired = vi.fn();
    const onError = vi.fn();
    const onBaselineMismatch = vi.fn();
    const provider = new providerModule.CollabProvider(doc, {
      postId,
      userName: "QA",
      color: "#000000",
      canPush: true,
      presence: false,
      onRetired,
      onError,
      onBaselineMismatch,
    });
    cleanups.push(() => provider.destroy());
    // Not awaited: the catch-up may be held open on purpose, and the editor
    // does not wait for it either.
    const started = provider.start();
    await settle();
    return { provider, onRetired, onError, onBaselineMismatch, started };
  }
  return {
    session,
    pushes,
    ack,
    sent,
    catchUps,
    storage,
    /** The relay's baseline revision, which a rotation changes under a session. */
    rebase: (revision: number) => {
      currentBaselineRevision = revision;
    },
    hold: (value: boolean) => {
      holdCatchUp = value;
    },
    release: async () => {
      releaseCatchUp?.();
      releaseCatchUp = null;
      await settle();
    },
  };
}

it("keeps writing after a save rebuilds the session with an edit already queued", async () => {
  const postId = "writer-survives-save";
  const harness = await setup(postId, 1);
  const doc = new Y.Doc();
  cleanups.push(() => doc.destroy());

  // A first session types and its update is acknowledged, so the outbox drains
  // and is released exactly as it is after a successful autosave.
  const first = await harness.session(doc);
  documentText(doc, "body").insert(7, " think");
  await vi.advanceTimersByTimeAsync(300);
  await settle();
  expect(harness.sent.length).toBe(1);
  await harness.ack();
  first.provider.destroy();
  await settle();

  // The save advanced the canonical revision to 2 while the collaborative
  // baseline is still 1. The editor rebuilds the session with that new number,
  // the person types before the catch-up lands, and the baseline then arrives
  // carrying the older revision. This is the exact window the note was lost in.
  harness.hold(true);
  const rebuilt = await harness.session(doc);
  documentText(doc, "body").insert(13, " this is the best episode");
  await settle();
  await harness.release();
  await vi.advanceTimersByTimeAsync(300);
  await settle();

  // The writer must still be alive, and the words typed in that window must
  // have reached the relay.
  expect(rebuilt.onBaselineMismatch).not.toHaveBeenCalled();
  expect(rebuilt.onRetired).not.toHaveBeenCalled();
  expect(harness.sent.length).toBeGreaterThan(1);
  await harness.ack();

  // And the session keeps writing afterwards, rather than silently accepting
  // text nothing persists.
  const before = harness.sent.length;
  const body = documentText(doc, "body");
  body.insert(body.length, " of the season.");
  await vi.advanceTimersByTimeAsync(300);
  await settle();
  expect(harness.sent.length).toBeGreaterThan(before);
  expect(documentText(doc, "body").toString()).toContain("best episode of the season");
});

it("reports a session that has not caught up as not caught up, and writes nothing", async () => {
  // The editor branches on this. A session whose catch-up has not landed
  // (offline, or the relay answering 5xx) still has a live writer: it has
  // nothing to write against yet, and the poll loop heals it. Reading its null
  // materialization as a dead writer is what locked the editor into the
  // recovery screen on the first offline keystroke.
  const postId = "writer-not-caught-up";
  const harness = await setup(postId, 3);
  const doc = new Y.Doc();
  cleanups.push(() => doc.destroy());
  harness.hold(true);
  const held = await harness.session(doc);
  documentText(doc, "body").insert(7, " typed offline");
  await settle();

  expect(held.provider.caughtUp).toBe(false);
  expect(await held.provider.materialize("me")).toBeNull();

  await harness.release();
  await settle();
  expect(held.provider.caughtUp).toBe(true);
});

it("preserves the queued edits when a session really is fenced out", async () => {
  const postId = "writer-fenced-preserves";
  const harness = await setup(postId, 9);
  const doc = new Y.Doc();
  cleanups.push(() => doc.destroy());
  const session = await harness.session(doc);
  await settle();

  // Type. The relay holds the push open, so the edit stays pending in the
  // outbox, which outlives this provider.
  documentText(doc, "body").insert(7, " and more");
  await vi.advanceTimersByTimeAsync(300);
  await settle();
  expect(harness.sent.length).toBe(1);
  session.provider.destroy();
  await settle();

  // A rotation reseeds the document while those edits are still queued, so the
  // next session catches up under a baseline revision the pending work was
  // never made against. That is a genuine fence, and the only correct outcome
  // is to stop writing AFTER preserving what the outbox holds.
  harness.rebase(11);
  const fenced = await harness.session(doc);
  await settle();

  expect(fenced.onBaselineMismatch).toHaveBeenCalledWith(11);
  expect(fenced.onRetired).toHaveBeenCalled();
  const { readRetiredOutboxes } = await import("@/lib/collab/provider");
  const retired = await readRetiredOutboxes(postId);
  expect(retired.copies.length).toBeGreaterThan(0);
  const preserved = retired.copies.some((copy) => {
    if (!copy.state) return false;
    const rebuilt = new Y.Doc();
    try {
      Y.applyUpdate(rebuilt, Buffer.from(copy.state, "base64"));
      return documentText(rebuilt, "body").toString().includes("and more");
    } catch {
      return false;
    } finally {
      rebuilt.destroy();
    }
  });
  expect(preserved).toBe(true);
});
