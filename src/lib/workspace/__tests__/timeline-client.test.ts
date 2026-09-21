import { afterEach, expect, it, vi } from "vitest";
import { fetchWorkspaceTimeline, TimelineAccessError } from "../timeline-client";

afterEach(() => vi.unstubAllGlobals());
it.each([401, 403, 404])("distinguishes denied access (%s) from an unavailable server", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
  await expect(fetchWorkspaceTimeline("workspace", "all")).rejects.toBeInstanceOf(TimelineAccessError);
});
it.each([429, 500, 503])("does not invalidate cached access for a transient failure (%s)", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
  await expect(fetchWorkspaceTimeline("workspace", "all")).rejects.not.toBeInstanceOf(TimelineAccessError);
});
