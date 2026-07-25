"use client";

import { useEffect } from "react";
import { refreshWorkspacePool } from "@/lib/pool/store";

/**
 * Keeps the in-app workspace list live with the server. The app runs a native
 * sync engine alongside this web view, so content can change underneath it
 * (a file the engine pushed, a shared item, another device, an MCP edit) with
 * no user action here. This long-polls the same change cursor the native
 * engine uses (via the session-authed /api/workspace/changes) and refreshes
 * the pool only when that cursor advances. Hidden windows pause polling; the
 * next cursor-aware request catches up after visibility returns without a
 * speculative refresh or document reload.
 */
export function useWorkspaceLiveSync(handle: string, blogId: string): void {
  useEffect(() => {
    if (!handle || !blogId) return;
    let cancelled = false;
    let controller: AbortController | null = null;
    let cursor: string | null = null;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    type PollResult =
      | {
          kind: "changes";
          cursor?: string;
          changed?: boolean;
          build?: string;
        }
      | { kind: "retry"; retryAfterMs?: number }
      | { kind: "stop" };

    function retryAfterMs(response: Response): number | undefined {
      const value = response.headers.get("retry-after");
      if (!value) return undefined;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
      const date = Date.parse(value);
      if (!Number.isFinite(date)) return undefined;
      return Math.max(0, date - Date.now());
    }

    async function poll(wait: number): Promise<PollResult> {
      controller = new AbortController();
      const params = new URLSearchParams({ handle });
      if (cursor) params.set("cursor", cursor);
      if (wait > 0) params.set("wait", String(wait));
      try {
        const response = await fetch(
          `/api/workspace/changes?${params.toString()}`,
          {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );
        // Guest and shared read-only shells have no owner change feed. A 404 is
        // permanent for this mounted workspace, so do not keep waking the app.
        // A quota-paused database is also not recoverable by hammering it from
        // every open window. A fresh mount or navigation starts a new feed after
        // the service has been restored.
        if (
          response.status === 401 ||
          response.status === 402 ||
          response.status === 403 ||
          response.status === 404
        ) {
          return { kind: "stop" };
        }
        if (!response.ok) {
          return {
            kind: "retry",
            retryAfterMs: retryAfterMs(response),
          };
        }
        const body = (await response.json()) as {
          cursor?: string;
          changed?: boolean;
          build?: string;
        };
        return { kind: "changes", ...body };
      } catch {
        return { kind: "retry" }; // aborted or network blip
      }
    }

    async function run() {
      const initial = await poll(0);
      if (cancelled) return;
      if (initial.kind === "stop") return;
      if (initial.kind === "changes" && initial.cursor) {
        cursor = initial.cursor;
      }
      let failureDelayMs = 3000;
      if (initial.kind === "retry") {
        await sleep(Math.max(failureDelayMs, initial.retryAfterMs ?? 0));
        failureDelayMs = Math.min(failureDelayMs * 2, 5 * 60 * 1000);
      }

      while (!cancelled) {
        if (typeof document !== "undefined" && document.hidden) {
          await sleep(1000);
          continue;
        }
        const result = await poll(20);
        if (cancelled) return;
        if (result.kind === "stop") return;
        if (result.kind === "retry") {
          await sleep(Math.max(failureDelayMs, result.retryAfterMs ?? 0));
          failureDelayMs = Math.min(failureDelayMs * 2, 5 * 60 * 1000);
          continue;
        }
        failureDelayMs = 3000;
        if (result.changed) {
          void refreshWorkspacePool(handle, blogId);
        }
        if (result.cursor) cursor = result.cursor;
      }
    }

    void run();
    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [handle, blogId]);
}
