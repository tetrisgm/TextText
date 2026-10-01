import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ del: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/media-storage", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/media-storage")>(), isMediaStorageConfigured: () => true, del: mocks.del, list: mocks.list }));
import { purgeWorkspaceBlobs } from "@/lib/blob-purge";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("MEDIA_ORIGIN", "https://texttext.example"); mocks.del.mockResolvedValue(undefined); mocks.list.mockResolvedValue({ blobs: [], hasMore: false }); });
afterEach(() => vi.unstubAllEnvs());
describe("workspace R2 deletion boundaries", () => {
  it("never deletes referenced neighboring workspace assets or unrelated objects", async () => {
    const own = "https://texttext.example/api/media/documents/demo/item/own.png";
    mocks.list.mockResolvedValueOnce({ blobs: [{ pathname: "documents/demo/orphan.png", url: "https://texttext.example/api/media/documents/demo/orphan.png" }, { pathname: "documents/demo-two/other.png", url: "https://texttext.example/api/media/documents/demo-two/other.png" }], hasMore: false });
    await purgeWorkspaceBlobs({ handle: "demo", urls: [own, "https://texttext.example/api/media/documents/demo-two/item/foreign.png", "https://foreign.example/image.png"] });
    expect(mocks.del.mock.calls.flatMap(call => call[0])).toEqual([own, "https://texttext.example/api/media/documents/demo/orphan.png"]);
    expect(mocks.list.mock.calls.map(call => call[0].prefix)).toEqual(["documents/demo/", "captures/demo/", "editor/media/demo/"]);
  });
});
