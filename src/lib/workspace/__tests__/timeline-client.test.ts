import { afterEach, expect, it, vi } from "vitest";
import { fetchWorkspaceTimeline, refreshWorkspaceTimeline, TimelineAccessError } from "../timeline-client";
import type { TimelineEntry } from "../timeline";

afterEach(() => vi.unstubAllGlobals());
it.each([401, 403, 404])("distinguishes denied access (%s) from an unavailable server", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
  await expect(fetchWorkspaceTimeline("workspace", "all")).rejects.toBeInstanceOf(TimelineAccessError);
});
it.each([429, 500, 503])("does not invalidate cached access for a transient failure (%s)", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
  await expect(fetchWorkspaceTimeline("workspace", "all")).rejects.not.toBeInstanceOf(TimelineAccessError);
});

const entry = (id: string, at: string): TimelineEntry => ({ id, at, kind: "created", post: { id, blogId: "workspace", slug: id, title: id, type: "note", status: "draft", createdAt: at, updatedAt: at } });
it("refreshes through the oldest loaded row using the server's snapshot cursor", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({ entries: [entry("new", "5"), entry("a", "4")], nextCursor: "snapshot-page-2", snapshot: "today" }))
    .mockResolvedValueOnce(Response.json({ entries: [entry("older", "1")], nextCursor: "snapshot-page-3", snapshot: "today" }));
  vi.stubGlobal("fetch", request);
  const page = await refreshWorkspaceTimeline("workspace", "writing", { entries: [entry("a", "4"), entry("revoked", "2")], nextCursor: "old", snapshot: "yesterday" });
  expect(page.entries.map((item) => item.id)).toEqual(["new", "a", "older"]);
  expect(page.nextCursor).toBe("snapshot-page-3");
  expect(new URL(request.mock.calls[1][0], "http://localhost").searchParams.get("cursor")).toBe("snapshot-page-2");
  expect(request).toHaveBeenCalledTimes(2);
});
it("bounds revalidation at 500 rows when many new arrivals displace the old range", async () => {
  const request = vi.fn().mockImplementation(() => Response.json({ entries: Array.from({ length: 100 }, (_, i) => entry(`${request.mock.calls.length}-${i}`, "5")), nextCursor: `next-${request.mock.calls.length}`, snapshot: "today" }));
  vi.stubGlobal("fetch", request);
  const page = await refreshWorkspaceTimeline("workspace", "all", { entries: Array.from({ length: 100 }, (_, i) => entry(String(i), "1")), nextCursor: "old", snapshot: "yesterday" });
  expect(page.entries).toHaveLength(500);
  expect(request).toHaveBeenCalledTimes(5);
});
