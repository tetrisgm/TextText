import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RELEASE_POINTER_PATHNAME,
  blobBaseUrl,
  getCurrentAppRelease,
  parseAppRelease,
  releasePointerUrl,
  resetAppReleaseCache,
} from "@/lib/app-release";

const VALID_POINTER = {
  version: "1.2",
  buildNumber: 42,
  zipUrl: "https://abc123.public.blob.vercel-storage.com/releases/mac/Write-1.2.zip",
  appcastUrl: "https://abc123.public.blob.vercel-storage.com/releases/mac/appcast.xml",
  installerZipUrl:
    "https://abc123.public.blob.vercel-storage.com/releases/mac/install-write.zip",
  publishedAt: "2026-07-06T00:00:00.000Z",
};

const ENV_KEYS = ["WRITE_RELEASE_BLOB_BASE", "BLOB_READ_WRITE_TOKEN"] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  for (const key of ENV_KEYS) delete process.env[key];
  resetAppReleaseCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetAppReleaseCache();
});

function stubFetch(response: () => Promise<Response>) {
  const spy = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => response());
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseAppRelease", () => {
  it("accepts a full pointer", () => {
    expect(parseAppRelease(VALID_POINTER)).toEqual(VALID_POINTER);
  });

  it("accepts a pointer without the optional installer URL", () => {
    const { installerZipUrl: _omitted, ...rest } = VALID_POINTER;
    expect(parseAppRelease(rest)).toEqual({ ...rest, installerZipUrl: undefined });
  });

  it("coerces a digit-string buildNumber to a number", () => {
    const parsed = parseAppRelease({ ...VALID_POINTER, buildNumber: "42" });
    expect(parsed?.buildNumber).toBe(42);
  });

  it("rejects non-objects", () => {
    expect(parseAppRelease(null)).toBeNull();
    expect(parseAppRelease(undefined)).toBeNull();
    expect(parseAppRelease("1.2")).toBeNull();
    expect(parseAppRelease([VALID_POINTER])).toBeNull();
  });

  it("rejects a pointer missing any required field", () => {
    for (const key of ["version", "buildNumber", "zipUrl", "appcastUrl", "publishedAt"]) {
      const broken: Record<string, unknown> = { ...VALID_POINTER };
      delete broken[key];
      expect(parseAppRelease(broken)).toBeNull();
    }
  });

  it("rejects blank strings and bad build numbers", () => {
    expect(parseAppRelease({ ...VALID_POINTER, version: "  " })).toBeNull();
    expect(parseAppRelease({ ...VALID_POINTER, buildNumber: 0 })).toBeNull();
    expect(parseAppRelease({ ...VALID_POINTER, buildNumber: -3 })).toBeNull();
    expect(parseAppRelease({ ...VALID_POINTER, buildNumber: 1.5 })).toBeNull();
    expect(parseAppRelease({ ...VALID_POINTER, buildNumber: "v42" })).toBeNull();
  });

  it("rejects non-https required URLs", () => {
    expect(parseAppRelease({ ...VALID_POINTER, zipUrl: "not a url" })).toBeNull();
    expect(
      parseAppRelease({ ...VALID_POINTER, appcastUrl: "ftp://example.com/appcast.xml" }),
    ).toBeNull();
    expect(
      parseAppRelease({ ...VALID_POINTER, zipUrl: "http://blob.example.com/Write.zip" }),
    ).toBeNull();
  });

  it("allows plain http only for localhost URLs", () => {
    const local = parseAppRelease({
      ...VALID_POINTER,
      zipUrl: "http://localhost:3999/Write-1.2.zip",
    });
    expect(local?.zipUrl).toBe("http://localhost:3999/Write-1.2.zip");
  });

  it("drops a malformed installer URL instead of rejecting the release", () => {
    const parsed = parseAppRelease({ ...VALID_POINTER, installerZipUrl: "nope" });
    expect(parsed).not.toBeNull();
    expect(parsed?.installerZipUrl).toBeUndefined();
    expect(parsed?.zipUrl).toBe(VALID_POINTER.zipUrl);
  });
});

describe("blobBaseUrl + releasePointerUrl", () => {
  it("is null with no Blob env at all", () => {
    expect(blobBaseUrl()).toBeNull();
    expect(releasePointerUrl()).toBeNull();
  });

  it("derives the public origin from BLOB_READ_WRITE_TOKEN", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_Abc123XyZ_secretsecret";
    expect(blobBaseUrl()).toBe("https://abc123xyz.public.blob.vercel-storage.com");
    expect(releasePointerUrl()).toBe(
      `https://abc123xyz.public.blob.vercel-storage.com/${RELEASE_POINTER_PATHNAME}`,
    );
  });

  it("prefers WRITE_RELEASE_BLOB_BASE and trims trailing slashes", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_Abc123XyZ_secretsecret";
    process.env.WRITE_RELEASE_BLOB_BASE = "http://localhost:3999/blob///";
    expect(releasePointerUrl()).toBe(
      `http://localhost:3999/blob/${RELEASE_POINTER_PATHNAME}`,
    );
  });

  it("ignores a malformed token", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "not-a-blob-token";
    expect(blobBaseUrl()).toBeNull();
  });
});

describe("getCurrentAppRelease", () => {
  it("resolves null without touching the network when Blob env is missing", async () => {
    const spy = stubFetch(async () => jsonResponse(VALID_POINTER));
    await expect(getCurrentAppRelease()).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches, parses, and caches the pointer", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_Abc123XyZ_secretsecret";
    const spy = stubFetch(async () => jsonResponse(VALID_POINTER));

    await expect(getCurrentAppRelease()).resolves.toEqual(VALID_POINTER);
    await expect(getCurrentAppRelease()).resolves.toEqual(VALID_POINTER);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toBe(
      `https://abc123xyz.public.blob.vercel-storage.com/${RELEASE_POINTER_PATHNAME}`,
    );
  });

  it("refetches after the 60s cache window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00.000Z"));
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_Abc123XyZ_secretsecret";
    const spy = stubFetch(async () => jsonResponse(VALID_POINTER));

    await getCurrentAppRelease();
    vi.setSystemTime(new Date("2026-07-06T12:00:59.000Z"));
    await getCurrentAppRelease();
    expect(spy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-07-06T12:01:01.000Z"));
    await getCurrentAppRelease();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("resolves null on a 404 pointer and caches the miss", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_Abc123XyZ_secretsecret";
    const spy = stubFetch(async () => new Response("not found", { status: 404 }));

    await expect(getCurrentAppRelease()).resolves.toBeNull();
    await expect(getCurrentAppRelease()).resolves.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("resolves null when the fetch throws", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_Abc123XyZ_secretsecret";
    stubFetch(async () => {
      throw new Error("network down");
    });
    await expect(getCurrentAppRelease()).resolves.toBeNull();
  });

  it("resolves null on malformed pointer JSON", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_Abc123XyZ_secretsecret";
    stubFetch(async () => new Response("{ nope", { status: 200 }));
    await expect(getCurrentAppRelease()).resolves.toBeNull();

    resetAppReleaseCache();
    stubFetch(async () => jsonResponse({ version: "1.2" }));
    await expect(getCurrentAppRelease()).resolves.toBeNull();
  });
});
