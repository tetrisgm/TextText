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
        peer.provider === candidate.provider
      );
    })
  );
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
    let cancelled = false;
    let reading = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const abort = new AbortController();

    const read = async () => {
      if (document.visibilityState === "hidden" || reading) return;
      reading = true;
      try {
        const res = await fetch(
          `/api/collab/${encodeURIComponent(postId)}/presence`,
          { headers: { Accept: "application/json" }, signal: abort.signal },
        );
        if (res.status === 401 || res.status === 403 || res.status === 410) {
          if (!cancelled) setState({ postId, peers: [] });
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { presence?: PresencePeer[] };
        if (!cancelled) {
          const nextPeers = data.presence ?? [];
          setState((current) =>
            current.postId === postId &&
            presencePeersEqual(current.peers, nextPeers)
              ? current
              : { postId, peers: nextPeers },
          );
        }
      } catch {
        // Presence is decoration. A failed read leaves the last known list.
      } finally {
        reading = false;
      }
    };

    const stopTimer = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (document.visibilityState === "hidden" || timer) return;
      void read();
      timer = setInterval(() => void read(), POLL_MS);
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") stopTimer();
      else start();
    };

    start();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      cancelled = true;
      abort.abort();
      stopTimer();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [postId]);

  return peers;
}
