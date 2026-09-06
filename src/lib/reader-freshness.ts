import { startVisiblePoll } from "@/lib/visible-poll";

/** Refresh the server-rendered page on revision change. Readers never join Yjs or presence. */
export function startReaderFreshness(postId: string, revision: string, refresh: () => void) {
  let denied = false;
  return startVisiblePoll(async (signal) => {
    if (denied) return;
    try {
      const response = await fetch(`/api/items/${encodeURIComponent(postId)}/reader-revision`, {
        cache: "no-store", signal,
      });
      if (signal.aborted) return;
      if ([401, 403, 404, 410].includes(response.status)) {
        denied = true;
        refresh(); // Re-run the page's permission checks and remove an inaccessible reader.
        return;
      }
      if (!response.ok) return;
      const next: unknown = await response.json();
      if (!signal.aborted && next && typeof next === "object" && "revision" in next &&
        typeof next.revision === "string" && next.revision !== revision) refresh();
    } catch {
      // Keep the last rendered document through a transient failure; retry while visible.
    }
  });
}
