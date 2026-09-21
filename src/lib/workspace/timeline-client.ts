import type { TimelineFilter, TimelinePage } from "./timeline";

export async function fetchWorkspaceTimeline(handle: string, filter: TimelineFilter, cursor?: string | null): Promise<TimelinePage> {
  const params = new URLSearchParams({ handle, filter });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/workspace/timeline?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load timeline");
  return response.json();
}
