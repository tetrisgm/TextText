import type { TimelineFilter, TimelinePage } from "./timeline";

export class TimelineAccessError extends Error {
  constructor() { super("Workspace access is unavailable"); }
}

export async function fetchWorkspaceTimeline(handle: string, filter: TimelineFilter, cursor?: string | null): Promise<TimelinePage> {
  const params = new URLSearchParams({ handle, filter });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/workspace/timeline?${params}`, { cache: "no-store" });
  if ([401, 403, 404].includes(response.status)) throw new TimelineAccessError();
  if (!response.ok) throw new Error("Could not load timeline");
  return response.json();
}
