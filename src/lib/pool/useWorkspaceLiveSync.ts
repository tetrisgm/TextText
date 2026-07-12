"use client";

import { useEffect } from "react";
import { refreshWorkspacePool } from "@/lib/pool/store";

/**
 * Keeps the in-app workspace list live with the server. The app runs a native
 * sync engine alongside this web view, so content can change underneath it
 * (a file the engine pushed, a shared item, another device, an MCP edit) with
 * no user action here. This long-polls the same change cursor the native
 * engine uses (via the session-authed /api/workspace/changes) and refreshes
 * the pool whenever the cursor advances. It also refreshes on regaining
 * visibility, to catch anything that changed while the window was hidden.
 */
export function useWorkspaceLiveSync(handle: string, blogId: string): void {
  useEffect(() => {
    if (!handle || !blogId) return;
    let cancelled = false;
    let controller: AbortController | null = null;
    let cursor: string | null = null;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    async function poll(wait: number): Promise<{ cursor?: string; changed?: boolean } | null> {
      controller = new AbortController();
      const params = new URLSearchParams({ handle });
      if (cursor) params.set("cursor", cursor);
      if (wait > 0) params.set("wait", String(wait));
      try {
        const response = await fetch(`/api/workspace/changes?${params.toString()}`, {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return null;
        return (await response.json()) as { cursor?: string; changed?: boolean };
      } catch {
        return null; // aborted or network blip; the loop backs off and retries
      }
    }

    async function run() {
      const initial = await poll(0);
      if (cancelled) return;
      if (initial?.cursor) cursor = initial.cursor;

      while (!cancelled) {
        if (typeof document !== "undefined" && document.hidden) {
          await sleep(1000);
          continue;
        }
        const result = await poll(20);
        if (cancelled) return;
        if (!result) {
          await sleep(3000); // error backoff
          continue;
        }
        if (result.changed) {
          void refreshWorkspacePool(handle, blogId);
        }
        if (result.cursor) cursor = result.cursor;
      }
    }

    // Regaining focus is the cheapest catch-up for anything missed while hidden.
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        void refreshWorkspacePool(handle, blogId);
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }

    void run();
    return () => {
      cancelled = true;
      controller?.abort();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [handle, blogId]);
}
