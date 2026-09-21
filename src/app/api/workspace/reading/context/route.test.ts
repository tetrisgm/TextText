import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ reader: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/reading/list.server", () => ({ listReadingItems: mocks.list }));
vi.mock("../_shared", () => ({
  requireReader: mocks.reader,
  handleFrom: (request: Request) => new URL(request.url).searchParams.get("handle"),
  json: (body: unknown) => Response.json(body, { headers: { "Cache-Control": "private, no-store" } }),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
import { GET } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  mocks.reader.mockReset().mockResolvedValue({ ok: true, user: { userId: "reader" } });
  mocks.list.mockReset().mockResolvedValue({ items: [{ id, title: "NASA water", folderPath: "news/nasa", publisherName: "NASA", body: "Never return document bodies" }] });
});
it("uses the authorized reader and returns only bounded source metadata", async () => {
  const response = await GET(new Request("http://localhost/api?handle=mira&q=NASA"));
  expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ handle: "mira", user: { userId: "reader" }, limit: 8, scope: expect.objectContaining({ query: "NASA", includeDescendants: true }) }));
  expect(await response.json()).toEqual({ items: [{ id, name: "NASA water", detail: "news/nasa · NASA" }] });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("resolves selected source ids without falling back to an unfiltered list", async () => {
  await GET(new Request(`http://localhost/api?handle=mira&ids=${id}`));
  expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 5, scope: expect.objectContaining({ ids: [id] }) }));
  mocks.list.mockClear();
  for (const query of ["ids=", "ids=invalid", "q=x", `q=${"a".repeat(201)}`, `ids=${Array.from({ length: 6 }, (_, i) => id.slice(0, -1) + i).join(",")}`]) {
    expect((await GET(new Request(`http://localhost/api?handle=mira&${query}`))).status).toBe(400);
  }
  expect(mocks.list).not.toHaveBeenCalled();
});
it("does not query sources after workspace access is denied", async () => {
  mocks.reader.mockResolvedValue({ ok: false, response: new Response(null, { status: 404 }) });
  expect((await GET(new Request("http://localhost/api?handle=mira&q=NASA"))).status).toBe(404);
  expect(mocks.list).not.toHaveBeenCalled();
});
