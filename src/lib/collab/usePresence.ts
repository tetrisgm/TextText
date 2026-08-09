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

export function usePresence(postId: string | null | undefined): PresencePeer[] {
  const [peers, setPeers] = useState<PresencePeer[]>([]);

  useEffect(() => {
    if (!postId) {
      setPeers([]);
      return;
    }
    let cancelled = false;
    const abort = new AbortController();

    const read = async () => {
      try {
        const res = await fetch(
          `/api/collab/${encodeURIComponent(postId)}/presence`,
          { headers: { Accept: "application/json" }, signal: abort.signal },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { presence?: PresencePeer[] };
        if (!cancelled) setPeers(data.presence ?? []);
      } catch {
        // Presence is decoration. A failed read leaves the last known list.
      }
    };

    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => {
      cancelled = true;
      abort.abort();
      clearInterval(timer);
    };
  }, [postId]);

  return peers;
}
