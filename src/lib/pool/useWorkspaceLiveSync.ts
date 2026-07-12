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
function isEditingSomething(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function useWorkspaceLiveSync(handle: string, blogId: string): void {
  useEffect(() => {
    if (!handle || !blogId) return;
    let cancelled = false;
    let controller: AbortController | null = null;
    let cursor: string | null = null;

    // Reload the app onto new code without a manual Cmd-R. Note the build the
    // client booted with; when a poll reports a newer one, reload as soon as it
    // is safe: on regaining focus, or after a stretch of no typing. Never
    // interrupt an edit in progress.
    let bootBuild: string | null = null;
    let updatePending = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const reloadIfSafe = () => {
      if (!updatePending || cancelled) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (isEditingSomething()) {
        armIdleReload();
        return;
      }
      window.location.reload();
    };
    const armIdleReload = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(reloadIfSafe, 30_000);
    };
    const noteBuild = (build?: string) => {
      if (!build) return;
      if (bootBuild === null) {
        bootBuild = build;
      } else if (build !== bootBuild && !updatePending) {
        updatePending = true;
        armIdleReload(); // reload once he stops typing, or on next focus
      }
    };

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    async function poll(
      wait: number,
    ): Promise<{ cursor?: string; changed?: boolean; build?: string } | null> {
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
        return (await response.json()) as {
          cursor?: string;
          changed?: boolean;
          build?: string;
        };
      } catch {
        return null; // aborted or network blip; the loop backs off and retries
      }
    }

    async function run() {
      const initial = await poll(0);
      if (cancelled) return;
      if (initial?.cursor) cursor = initial.cursor;
      noteBuild(initial?.build);

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
        noteBuild(result.build);
      }
    }

    // Regaining focus is the cheapest catch-up for anything missed while
    // hidden, and the safest moment to reload onto new code.
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        void refreshWorkspacePool(handle, blogId);
        reloadIfSafe();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }

    void run();
    return () => {
      cancelled = true;
      controller?.abort();
      if (idleTimer) clearTimeout(idleTimer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [handle, blogId]);
}
