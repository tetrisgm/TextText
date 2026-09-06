import { startVisiblePoll } from "@/lib/visible-poll";

/** Refresh the server-rendered page on revision change. Readers never join Yjs or presence. */
export function startReaderFreshness(postId: string, revision: string, refresh: () => void | Promise<void>) {
  let denied = false;
  let target: string | null = null;
  let pending = false;
  let retryAt = 0;
  let retryDelay = 30_000;
  const requestRefresh = async (nextRevision: string) => {
    if (pending) return;
    if (target === nextRevision && Date.now() < retryAt) return;
    if (target !== nextRevision) retryDelay = 30_000;
    target = nextRevision;
    pending = true;
    // router.refresh returns void. Until new props replace this poll, treat an
    // unchanged render like a failure, retrying at 30s, 60s, then at most 120s.
    retryAt = Date.now() + retryDelay;
    retryDelay = Math.min(retryDelay * 2, 120_000);
    try {
      await refresh();
    } finally {
      pending = false;
    }
  };
  return startVisiblePoll(async (signal) => {
    if (denied) return;
    try {
      const response = await fetch(`/api/items/${encodeURIComponent(postId)}/reader-revision`, {
        cache: "no-store", signal,
      });
      if (signal.aborted) return;
      if ([401, 403, 404, 410].includes(response.status)) {
        denied = true;
        await refresh(); // Re-run the page's permission checks and remove an inaccessible reader.
        return;
      }
      if (!response.ok) return;
      const next: unknown = await response.json();
      if (!signal.aborted && next && typeof next === "object" && "revision" in next &&
        typeof next.revision === "string" && next.revision !== revision) await requestRefresh(next.revision);
    } catch {
      // Keep the last rendered document through a transient failure; retry while visible.
    }
  });
}
