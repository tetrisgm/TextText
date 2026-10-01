import { lstat, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  del,
  isMediaStorageConfigured,
  list,
  mediaKeyFromUrl,
  put,
  readMedia,
  validMediaKey,
} from "@/lib/media-storage";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "texttext-media-"));
  vi.stubEnv("TEXTTEXT_MEDIA_ROOT", join(directory, "media"));
  vi.stubEnv("MEDIA_ORIGIN", "https://texttext.example");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("Oracle-local media storage", () => {
  it("atomically writes bounded private objects and returns only application URLs", async () => {
    const result = await put(
      "documents/demo/item/assets/photo.png",
      new Uint8Array([1, 2]),
      { contentType: "image/png" },
    );
    expect(result.url).toMatch(
      /^https:\/\/texttext\.example\/api\/media\/documents\/demo\/item\/assets\/[a-f0-9-]+-photo\.png$/,
    );
    const object = join(process.env.TEXTTEXT_MEDIA_ROOT!, "objects", ...result.pathname.split("/"));
    const metadata = join(process.env.TEXTTEXT_MEDIA_ROOT!, "metadata", ...result.pathname.split("/")) + ".json";
    expect([...await readFile(object)]).toEqual([1, 2]);
    expect(JSON.parse(await readFile(metadata, "utf8"))).toEqual({ version: 1, contentType: "image/png", size: 2 });
    expect((await lstat(object)).mode & 0o777).toBe(0o600);
    await expect(put("documents/demo/../bad", new Uint8Array([1]), { contentType: "image/png" })).rejects.toThrow("path");
    await expect(put("documents/demo/x", new Uint8Array(0), { contentType: "image/png" })).rejects.toThrow("50 MB");
    await expect(put("documents/demo/x", new Uint8Array([1]), { contentType: "text/html" })).rejects.toThrow("content type");
  });

  it("never deletes foreign URLs, legacy Blob objects, traversal or signed query variants", async () => {
    const saved = await put("documents/demo/item/photo.png", new Uint8Array([1]), { contentType: "image/png" });
    await del([
      saved.url,
      saved.url,
      saved.url.replace("texttext.example", "evil.example"),
      `${saved.url}?key=1`,
      "https://store.public.blob.vercel-storage.com/old.png",
    ]);
    expect((await readMedia(saved.pathname, null)).status).toBe(404);
    expect(mediaKeyFromUrl("https://texttext.example/api/media/documents/demo/%2e%2e/secret")).toBeNull();
    expect(validMediaKey("documents/demo/a\\b")).toBe(false);
  });

  it("uses deletion-stable bounded cursors without skipping the next page", async () => {
    const saved = [];
    for (let index = 0; index < 102; index += 1) {
      saved.push(await put(
        `documents/demo/item/${String(index).padStart(3, "0")}.png`,
        new Uint8Array([index]),
        { contentType: "image/png" },
      ));
    }
    const first = await list({ prefix: "documents/demo/" });
    expect(first.blobs).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBeTruthy();
    await del(first.blobs.map(entry => entry.url));
    const second = await list({ prefix: "documents/demo/", cursor: first.cursor });
    expect(second.blobs).toHaveLength(2);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.blobs, ...second.blobs].map(entry => entry.pathname)).size).toBe(102);
    await expect(list({ prefix: "documents/demo/", cursor: "next" })).rejects.toThrow("cursor");
  });

  it("streams authorized delivery with exact ranges and no shared cache", async () => {
    const saved = await put("documents/demo/item/video.mp4", new Uint8Array([1, 2, 3]), { contentType: "video/mp4" });
    const response = await readMedia(saved.pathname, "bytes=1-2");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 1-2/3");
    expect(response.headers.get("content-length")).toBe("2");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3]);

    const suffix = await readMedia(saved.pathname, "bytes=-2");
    expect([...new Uint8Array(await suffix.arrayBuffer())]).toEqual([2, 3]);
    const invalid = await readMedia(saved.pathname, "bytes=4-");
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe("bytes */3");
    expect((await readMedia(saved.pathname, "bytes=1-2,4-5")).status).toBe(416);
  });

  it("fails closed for missing configuration and symbolic-link storage roots", async () => {
    vi.stubEnv("TEXTTEXT_MEDIA_ROOT", "");
    expect(isMediaStorageConfigured()).toBe(false);
    await expect(put("documents/demo/item/a.png", new Uint8Array([1]), { contentType: "image/png" })).rejects.toThrow("not configured");

    const actual = join(directory, "actual");
    const linked = join(directory, "linked");
    await mkdir(actual);
    await symlink(actual, linked);
    vi.stubEnv("TEXTTEXT_MEDIA_ROOT", linked);
    await expect(put("documents/demo/item/a.png", new Uint8Array([1]), { contentType: "image/png" })).rejects.toThrow("symbolic link");
  });
});
