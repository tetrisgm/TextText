import { beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/store", () => ({ readPublicVaultAsset: read }));
import { GET, HEAD } from "./route";

const url = "https://texttext.test/api/public/vault/workspace-1/item-1/assets/picture.png";
const context = { params: Promise.resolve({ workspaceId: "workspace-1", itemId: "item-1", assetPath: ["picture.png"] }) };

describe("public TextPack assets", () => {
  beforeEach(() => {
    read.mockReset();
    read.mockResolvedValue({ data: new Uint8Array([1, 2, 3, 4]), contentType: "image/png", download: false });
  });

  it("reads the current publication on each request, supports one byte range, and never caches", async () => {
    const response = await GET(new Request(url, { headers: { range: "bytes=1-2" } }), context);
    expect(response.status).toBe(206);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-range")).toBe("bytes 1-2/4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([2, 3]));
    expect(read).toHaveBeenCalledWith({ workspaceId: "workspace-1", itemId: "item-1", assetPath: "assets/picture.png" });
    expect((await HEAD(new Request(url, { method: "HEAD" }), context)).status).toBe(200);
    read.mockResolvedValue(null);
    expect((await GET(new Request(url), context)).status).toBe(404);
    expect(read).toHaveBeenCalledTimes(3);
  });
});
