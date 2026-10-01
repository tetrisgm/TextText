import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), configuration: vi.fn() }));
vi.mock("@aws-sdk/client-s3", async importOriginal => ({
  ...await importOriginal<typeof import("@aws-sdk/client-s3")>(),
  S3Client: vi.fn(function (configuration) { mocks.configuration(configuration); return { send: mocks.send, destroy: mocks.destroy }; }),
}));
import { put, del, list, readMedia, mediaKeyFromUrl, validMediaKey, isMediaStorageConfigured } from "@/lib/media-storage";
beforeEach(() => {
  vi.resetAllMocks();
  for (const [key, value] of Object.entries({ R2_MEDIA_ACCOUNT_ID: "a".repeat(32), R2_MEDIA_BUCKET: "private-media", R2_MEDIA_ACCESS_KEY_ID: "test-id", R2_MEDIA_SECRET_ACCESS_KEY: "test-only", MEDIA_ORIGIN: "https://texttext.example" })) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());
describe("private R2 media storage", () => {
  it("writes bounded immutable objects to the private prefix and returns only application URLs", async () => {
    mocks.send.mockResolvedValue({});
    const result = await put("documents/demo/item/assets/photo.png", new Uint8Array([1, 2]), { contentType: "image/png" });
    expect(result.url).toMatch(/^https:\/\/texttext.example\/api\/media\/documents\/demo\/item\/assets\/[a-f0-9-]+-photo.png$/);
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({ Bucket: "private-media", Key: `media/v1/${result.pathname}`, IfNoneMatch: "*", ContentLength: 2, ContentType: "image/png" });
    expect(mocks.send.mock.calls[0][0].input).not.toHaveProperty("ACL");
    expect(mocks.configuration.mock.calls[0][0]).toMatchObject({ region: "auto", endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com` });
    expect(mocks.destroy).toHaveBeenCalledOnce();
    await expect(put("documents/demo/../bad", new Uint8Array([1]), { contentType: "image/png" })).rejects.toThrow("path");
    await expect(put("documents/demo/x", new Uint8Array(0), { contentType: "image/png" })).rejects.toThrow("50 MB");
    await expect(put("documents/demo/x", new Uint8Array([1]), { contentType: "text/html" })).rejects.toThrow("content type");
  });
  it("never deletes foreign URLs, legacy Blob objects, traversal or signed query variants", async () => {
    mocks.send.mockResolvedValue({});
    const own = "https://texttext.example/api/media/documents/demo/item/photo.png";
    await del([own, own, "https://evil.example/api/media/documents/demo/item/photo.png", `${own}?key=1`, "https://store.public.blob.vercel-storage.com/old.png"]);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0][0].input.Delete.Objects).toEqual([{ Key: "media/v1/documents/demo/item/photo.png" }]);
    expect(mediaKeyFromUrl("https://texttext.example/api/media/documents/demo/%2e%2e/secret")).toBeNull();
    expect(validMediaKey("documents/demo/a\\b")).toBe(false);
    mocks.send.mockResolvedValue({ Errors: [{ Key: "x" }] });
    await expect(del(own)).rejects.toThrow("could not be deleted");
  });
  it("bounds lists and rejects broken cursors or unrelated keys", async () => {
    mocks.send.mockResolvedValue({ Contents: [{ Key: "media/v1/documents/demo/a.png" }, { Key: "media/v1/documents/other/b.png" }], IsTruncated: true, NextContinuationToken: "next" });
    expect((await list({ prefix: "documents/demo/" })).blobs).toHaveLength(1);
    expect(mocks.send.mock.calls[0][0].input.MaxKeys).toBe(100);
    await expect(list({ prefix: "documents/demo/", cursor: "next" })).rejects.toThrow("cursor");
  });
  it("streams authenticated delivery with ranges, no shared cache, and cleanup", async () => {
    mocks.send.mockResolvedValue({ ContentType: "video/mp4", ContentLength: 2, ContentRange: "bytes 1-2/3", Body: { transformToWebStream: () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([2, 3])); controller.close(); } }) } });
    const response = await readMedia("documents/demo/item/video.mp4", "bytes=1-2");
    expect(response.status).toBe(206); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3]); expect(mocks.destroy).toHaveBeenCalledOnce();
    expect((await readMedia("documents/demo/item/video.mp4", "bytes=1-2,4-5")).status).toBe(416);
    mocks.send.mockRejectedValue({ $metadata: { httpStatusCode: 404 } });
    expect((await readMedia("documents/demo/item/missing.png", null)).status).toBe(404);
  });
  it("fails closed without deployment configuration", async () => {
    vi.stubEnv("R2_MEDIA_SECRET_ACCESS_KEY", ""); expect(isMediaStorageConfigured()).toBe(false);
    await expect(put("documents/demo/item/a.png", new Uint8Array([1]), { contentType: "image/png" })).rejects.toThrow("not configured");
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
