import type { TimelineFilter, TimelinePage } from "./timeline";

export class TimelineAccessError extends Error {
  constructor() { super("Workspace access is unavailable"); }
}

export async function fetchWorkspaceTimeline(handle: string, filter: TimelineFilter, cursor?: string | null, limit?: number): Promise<TimelinePage> {
  const params = new URLSearchParams({ handle, filter });
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  const response = await fetch(`/api/workspace/timeline?${params}`, { cache: "no-store" });
  if ([401, 403, 404].includes(response.status)) throw new TimelineAccessError();
  if (!response.ok) throw new Error("Could not load timeline");
  return response.json();
}

/** Revalidate the loaded range, bounded to the same 500 rows as the session cache. */
export async function refreshWorkspaceTimeline(handle: string, filter: TimelineFilter, previous: TimelinePage | null): Promise<TimelinePage> {
  const boundary = previous?.entries.at(-1);
  let page = await fetchWorkspaceTimeline(handle, filter, null, Math.min(100, Math.max(40, previous?.entries.length ?? 0)));
  let entries = page.entries;
  const coversBoundary = () => {
    const last = entries.at(-1);
    return !boundary || !last || last.at < boundary.at || (last.at === boundary.at && last.id <= boundary.id);
  };
  while (page.nextCursor && !coversBoundary() && entries.length < 500) {
    page = await fetchWorkspaceTimeline(handle, filter, page.nextCursor, Math.min(100, 500 - entries.length));
    entries = [...entries, ...page.entries];
  }
  return { ...page, entries };
}
