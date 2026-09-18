import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyDocumentBaseline,
  createDocumentYDoc,
  documentSnapshotFromYDoc,
  documentTags,
  documentText,
} from "@/lib/collab/document";
import { replaceSharedText } from "@/lib/collab/text-transactions";
import { validateDocumentSnapshot } from "@/lib/documents/model";

/**
 * Several people, one document, and a network that does not cooperate.
 *
 * bench-sync.ts proves two real browsers agree on a good day. This proves the
 * layer underneath them agrees on a bad one: peers editing at the same time,
 * updates arriving out of order, arriving twice, arriving very late, or
 * arriving in batches that were never sent together. Those are not exotic;
 * they are what a phone on a train does.
 *
 * Three properties, checked after every run:
 *
 *   EVERYONE ENDS UP WITH THE SAME DOCUMENT. Not merely the same length: the
 *   same text, the same tags, the same fields.
 *
 *   NOBODY'S WORDS ARE DROPPED. Every peer's own insertion is somewhere in
 *   the converged text, and the text is exactly as long as everything typed
 *   into it. Each insertion is a single character precisely so this can be
 *   asserted: two peers typing at the same place interleave, which would
 *   split a word marker down the middle and make a correct merge look like a
 *   loss. Where a character lands is the CRDT's business; that every one of
 *   them is still there, once each, is not negotiable.
 *
 *   WHAT THEY AGREE ON CAN BE STORED. The converged document still validates
 *   against the schema the database will accept, so convergence cannot end in
 *   a state the app has to refuse.
 *
 * Randomized, and the seed is printed with any failure so it can be run
 * again. TEXTTEXT_CONVERGENCE_ROUNDS turns it up for a longer soak.
 */

const ROUNDS = Number(process.env.TEXTTEXT_CONVERGENCE_ROUNDS ?? 40);

function randomFrom(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/**
 * A distinct single character per insertion. One character cannot be split by
 * somebody typing into the middle of it, so "is it still there" stays a
 * question about the merge rather than about the marker.
 */
const markFor = (n: number) => String.fromCodePoint(0x4e00 + (n % 20000));

const START = validateDocumentSnapshot({
  schemaVersion: 1,
  content: { title: "Shared", body: "the document as it started\n", fields: {}, tags: [], assets: [] },
  presentation: { template: { id: "texttext.note", version: 1 }, theme: {} },
});

type Peer = {
  name: string;
  doc: Y.Doc;
  /** Updates this peer produced, in the order it produced them. */
  sent: { from: string; update: Uint8Array }[];
  /** What this peer wrote, which must survive. */
  wrote: string[];
};

/** Peers that all seeded from the same snapshot, the way a real session does. */
function openPeers(count: number): Peer[] {
  const peers: Peer[] = [];
  for (let index = 0; index < count; index += 1) {
    // Every peer seeds from the same deterministic baseline, which is what
    // stops a reconnecting client creating a second text history.
    const doc = createDocumentYDoc();
    applyDocumentBaseline(doc, START, "shared-seed");
    const peer: Peer = { name: `peer-${index}`, doc, sent: [], wrote: [] };
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "remote" || origin === "document-baseline") return;
      peer.sent.push({ from: peer.name, update });
    });
    peers.push(peer);
  }
  return peers;
}

function textOf(peer: Peer): string {
  return documentText(peer.doc, "body").toString();
}

describe("many peers converging on one document", () => {
  it("CV-01: concurrent edits converge, and every peer's words survive", () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const seed = (round + 1) * 7919;
      const random = randomFrom(seed);
      const peers = openPeers(2 + Math.floor(random() * 3));

      // Each peer writes where it happens to be looking, which is not where
      // anybody else is.
      let minted = round * 1000;
      const startLength = documentText(peers[0].doc, "body").length;
      for (let pass = 0; pass < 3; pass += 1) {
        for (const peer of peers) {
          const body = documentText(peer.doc, "body");
          const mark = markFor((minted += 1));
          const at = Math.floor(random() * (body.length + 1));
          replaceSharedText(body, at, 0, mark, "local");
          peer.wrote.push(mark);
          if (random() < 0.3) documentTags(peer.doc).push([`${peer.name}-${pass}`]);
        }
      }

      // A network that reorders, duplicates and delays. Every update still
      // reaches everyone in the end, which is the only thing a CRDT is owed.
      const inFlight = peers.flatMap((peer) => peer.sent.map((entry) => ({ ...entry })));
      const delivery = [...inFlight, ...inFlight.filter(() => random() < 0.25)];
      for (let index = delivery.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [delivery[index], delivery[swap]] = [delivery[swap], delivery[index]];
      }
      for (const entry of delivery) {
        for (const peer of peers) {
          if (peer.name === entry.from) continue;
          Y.applyUpdate(peer.doc, entry.update, "remote");
        }
      }

      const texts = peers.map(textOf);
      const first = texts[0];
      for (let index = 1; index < texts.length; index += 1) {
        expect(texts[index], `seed ${seed}: ${peers[index].name} disagrees with ${peers[0].name}`).toBe(first);
      }

      const typed = peers.flatMap((peer) => peer.wrote);
      for (const peer of peers) {
        for (const written of peer.wrote) {
          expect(first.includes(written), `seed ${seed}: ${peer.name} lost what it typed`).toBe(true);
        }
      }
      // Once each: a duplicated update that was applied twice would show up
      // here even though every marker is present.
      for (const written of typed) {
        expect(first.split(written).length - 1, `seed ${seed}: a character was applied more than once`).toBe(1);
      }
      expect(first.length, `seed ${seed}: the converged text is not the length of what was typed into it`).toBe(
        startLength + typed.length,
      );

      const snapshots = peers.map((peer) => JSON.stringify(documentSnapshotFromYDoc(peer.doc)));
      for (let index = 1; index < snapshots.length; index += 1) {
        expect(snapshots[index], `seed ${seed}: the stored form differs between peers`).toBe(snapshots[0]);
      }

      // And the thing they agree on is a thing the database will take.
      expect(() => validateDocumentSnapshot(JSON.parse(snapshots[0]))).not.toThrow();
      for (const peer of peers) peer.doc.destroy();
    }
  });

  it("CV-02: a peer that was away for the whole session catches up exactly", () => {
    const random = randomFrom(20260918);
    const peers = openPeers(3);
    const [here, there, away] = peers;
    for (let pass = 0; pass < 8; pass += 1) {
      for (const peer of [here, there]) {
        const body = documentText(peer.doc, "body");
        const mark = markFor(80000 + pass * 10 + peers.indexOf(peer));
        replaceSharedText(body, Math.floor(random() * (body.length + 1)), 0, mark, "local");
        peer.wrote.push(mark);
      }
      // The two who are present stay in step with each other.
      for (const entry of [here, there].flatMap((peer) => peer.sent.splice(0))) {
        for (const peer of [here, there]) {
          if (peer.name === entry.from) continue;
          Y.applyUpdate(peer.doc, entry.update, "remote");
        }
      }
    }
    expect(textOf(here)).toBe(textOf(there));
    // The one who was away asks for everything since the state it had, which
    // is what a reconnect is, and lands on the same document.
    const missing = Y.encodeStateAsUpdate(here.doc, Y.encodeStateVector(away.doc));
    Y.applyUpdate(away.doc, missing, "remote");
    expect(textOf(away), "a peer that reconnected did not catch up").toBe(textOf(here));
  });

  it("CV-03: a peer that was away AND edited keeps both sides", () => {
    const random = randomFrom(31337);
    const [here, away] = openPeers(2);
    const offline = markFor(90001);
    replaceSharedText(documentText(away.doc, "body"), 0, 0, offline, "local");
    const online: string[] = [];
    for (let pass = 0; pass < 6; pass += 1) {
      const body = documentText(here.doc, "body");
      const mark = markFor(90100 + pass);
      replaceSharedText(body, Math.floor(random() * (body.length + 1)), 0, mark, "local");
      online.push(mark);
    }
    // Each side hands the other exactly what it is missing, in either order.
    const forAway = Y.encodeStateAsUpdate(here.doc, Y.encodeStateVector(away.doc));
    const forHere = Y.encodeStateAsUpdate(away.doc, Y.encodeStateVector(here.doc));
    Y.applyUpdate(away.doc, forAway, "remote");
    Y.applyUpdate(here.doc, forHere, "remote");
    expect(textOf(away)).toBe(textOf(here));
    expect(textOf(here).includes(offline), "the offline edit was lost on reconnect").toBe(true);
    for (const mark of online) {
      expect(textOf(away).includes(mark), "an edit made while the other peer was away was lost").toBe(true);
    }
  });

  it("CV-04: an update applied twice changes nothing the second time", () => {
    const [here, there] = openPeers(2);
    replaceSharedText(documentText(here.doc, "body"), 0, 0, " once ", "local");
    const update = here.sent[0].update;
    Y.applyUpdate(there.doc, update, "remote");
    const after = textOf(there);
    for (let again = 0; again < 5; again += 1) Y.applyUpdate(there.doc, update, "remote");
    expect(textOf(there), "a duplicated update was applied twice").toBe(after);
    expect(after.includes("once")).toBe(true);
  });

  it("CV-05: a deletion and an insertion at the same place do not corrupt each other", () => {
    const [here, there] = openPeers(2);
    // The same three words, removed by one person while the other types into
    // the middle of them. Both intentions have to survive as something a
    // person could have meant.
    const start = documentText(here.doc, "body").toString();
    const at = start.indexOf("document");
    replaceSharedText(documentText(here.doc, "body"), at, "document".length, "", "local");
    replaceSharedText(documentText(there.doc, "body"), at + 4, 0, "XX", "local");
    for (const entry of here.sent.splice(0)) Y.applyUpdate(there.doc, entry.update, "remote");
    for (const entry of there.sent.splice(0)) Y.applyUpdate(here.doc, entry.update, "remote");
    expect(textOf(here)).toBe(textOf(there));
    expect(textOf(here).includes("XX"), "the insertion vanished with the deletion around it").toBe(true);
    expect(() => documentSnapshotFromYDoc(here.doc)).not.toThrow();
  });
});
