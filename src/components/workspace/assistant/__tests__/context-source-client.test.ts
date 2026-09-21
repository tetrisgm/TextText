import { afterEach, expect, it, vi } from "vitest";
import { fetchContextSourceText } from "../context-source-client";

afterEach(() => vi.unstubAllGlobals());
const payload = { blogId: "workspace", postId: "source", fetchedAt: "2026-09-21T12:00:00Z", revision: 4,
  document: { schemaVersion: 1, content: { title: "NASA", body: "Source text" }, presentation: { template: { id: "texttext.article", version: 1 } } },
};
it("reads a canonical source absent from navigation without relying on cached text", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(payload));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchContextSourceText("workspace", "source")).toMatchObject({ title: "NASA", body: "Source text", revision: 4 });
  expect(fetch).toHaveBeenCalledWith("/api/post/source/body", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
});
it("rejects denied reads and mismatched workspace responses", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(Response.json({ ...payload, blogId: "different" })));
  await expect(fetchContextSourceText("workspace", "source")).rejects.toThrow("no longer available");
  await expect(fetchContextSourceText("workspace", "source")).rejects.toThrow("mismatch");
});
