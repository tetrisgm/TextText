"use client";

// Who is in this document right now, for a surface that is not the editor.
//
// The editor learns this from its collaboration provider, which also carries
// the Yjs document and every caret. A reader needs none of that machinery and
// should not pay for it, but it does need the answer to "is someone working in
// here", because otherwise a person reading a page has no idea a colleague or
// an agent is changing it under them.
//
// Deliberately read-only. Publishing presence from the reader would make every
// open tab count as a live participant, and `hasActiveCoEditors` uses that
// count to route agent writes. Watching should not change how writes are
// routed.

import { useEffect, useState } from "react";
import type { PresencePeer } from "@/lib/collab/provider";

const POLL_MS = 4000;
const pageIsVisible = () => document.visibilityState !== "hidden";

export function presencePeersEqual(
  left: readonly PresencePeer[],
  right: readonly PresencePeer[],
): boolean {
  return (
    left.length === right.length &&
    left.every((peer, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        peer.clientId === candidate.clientId &&
        peer.userName === candidate.userName &&
        peer.color === candidate.color &&
        peer.awareness === candidate.awareness &&
        peer.participantType === candidate.participantType &&
        peer.provider === candidate.provider &&
        peer.role === candidate.role
      );
    })
  );
}

type PresenceListener = (peers: PresencePeer[]) => void;

type PresenceEntry = {
  peers: PresencePeer[];
  listeners: Set<PresenceListener>;
  timer: ReturnType<typeof setInterval> | null;
  abort: AbortController;
  reading: boolean;
};

// One poller per item, however many surfaces ask. The reader's action bar, the
// editor's bar and a hidden bar kept mounted for a fast switch back would each
// otherwise run their own interval against the same endpoint.
const entries = new Map<string, PresenceEntry>();

function publish(entry: PresenceEntry, next: PresencePeer[]) {
  if (presencePeersEqual(entry.peers, next)) return;
  entry.peers = next;
  for (const listener of entry.listeners) listener(next);
}

async function read(postId: string, entry: PresenceEntry) {
  if (document.visibilityState === "hidden" || entry.reading) return;
  entry.reading = true;
  try {
    const res = await fetch(
      `/api/collab/${encodeURIComponent(postId)}/presence`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.any([entry.abort.signal, AbortSignal.timeout(8000)]) },
    );
    if (!res.ok) {
      // 401, 403 and 410 included: never keep advertising activity the server
      // no longer confirms.
      publish(entry, []);
      return;
    }
    const data = (await res.json()) as { presence?: PresencePeer[] };
    if (pageIsVisible() && entries.get(postId) === entry) publish(entry, data.presence ?? []);
  } catch {
    // Do not keep advertising activity after a failed presence read.
    publish(entry, []);
  } finally {
    entry.reading = false;
  }
}

function stopTimer(entry: PresenceEntry) {
  if (entry.timer) clearInterval(entry.timer);
  entry.timer = null;
}

function start(postId: string, entry: PresenceEntry) {
  if (document.visibilityState === "hidden" || entry.timer) return;
  void read(postId, entry);
  entry.timer = setInterval(() => void read(postId, entry), POLL_MS);
}

function visibilityChanged() {
  for (const [postId, entry] of entries) {
    if (document.visibilityState === "hidden") {
      stopTimer(entry);
      publish(entry, []);
    } else {
      start(postId, entry);
    }
  }
}

function subscribe(postId: string, listener: PresenceListener): () => void {
  let entry = entries.get(postId);
  if (!entry) {
    entry = { peers: [], listeners: new Set(), timer: null, abort: new AbortController(), reading: false };
    entries.set(postId, entry);
    if (entries.size === 1) document.addEventListener("visibilitychange", visibilityChanged);
    start(postId, entry);
  }
  entry.listeners.add(listener);
  const current = entry;
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size > 0 || entries.get(postId) !== current) return;
    stopTimer(current);
    current.abort.abort();
    entries.delete(postId);
    if (entries.size === 0) document.removeEventListener("visibilitychange", visibilityChanged);
  };
}

export function usePresence(postId: string | null | undefined): PresencePeer[] {
  const [state, setState] = useState<{ postId: string | null; peers: PresencePeer[] }>({
    postId: postId ?? null,
    peers: [],
  });
  // Peers belong to an item: switching items shows an empty row immediately
  // rather than the previous item's collaborators until the next poll.
  const peers = state.postId === (postId ?? null) ? state.peers : [];

  useEffect(() => {
    if (!postId) return;
    const listener: PresenceListener = (next) =>
      setState((current) =>
        current.postId === postId && presencePeersEqual(current.peers, next)
          ? current
          : { postId, peers: next },
      );
    const unsubscribe = subscribe(postId, listener);
    // Hydrate from the real snapshot, an empty one included, so a hook that
    // returns to an item never shows that item's stale peers from before.
    listener(entries.get(postId)?.peers ?? []);
    return unsubscribe;
  }, [postId]);

  return peers;
}
