import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadingRequestError, type ReadingListPage } from "../client";
import { refreshSavedLibrary, savedLibraryScope } from "../saved-library-client";

const view = { handle: "mira", folderPath: "research", query: "climate", state: "bookmarked" as const };
afterEach(() => vi.unstubAllGlobals());

describe("saved library revalidation", () => {
  it("replaces the whole loaded window and retains the final continuation cursor", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const request = new URL(url, "http://localhost");
      requests.push(request);
      const start = Number(request.searchParams.get("cursor") ?? 0);
      const count = Number(request.searchParams.get("limit"));
      return Response.json({ items: Array.from({ length: count }, (_, i) => ({ id: String(start + i) })), nextCursor: String(start + count), scope: savedLibraryScope(view), scopeFingerprint: "authorized" });
    }));
    const page = await refreshSavedLibrary(view, 240);
    expect(page.items).toHaveLength(240);
    expect(page.items[239].id).toBe("239");
    expect(page.nextCursor).toBe("240");
    expect(requests.map((url) => url.searchParams.get("limit"))).toEqual(["100", "100", "40"]);
    expect(requests.every((url) => url.searchParams.get("folder") === "research" && url.searchParams.get("q") === "climate" && url.searchParams.get("handle") === "mira")).toBe(true);
  });

  it("stops at the end of a shortened library", async () => {
    const fetch = vi.fn(async () => Response.json({ items: [], nextCursor: null } satisfies Partial<ReadingListPage>));
    vi.stubGlobal("fetch", fetch);
    expect((await refreshSavedLibrary(view, 240)).items).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves access status when a later page is denied instead of returning partial content", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ items: [{ id: "one" }], nextCursor: "next" }))
      .mockResolvedValueOnce(Response.json({ error: "Access denied" }, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(refreshSavedLibrary(view, 240)).rejects.toMatchObject({ status: 403, message: "Access denied" });
    expect(new ReadingRequestError("Offline", 503)).toBeInstanceOf(Error);
  });
});
