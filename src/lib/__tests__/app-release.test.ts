import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  blobBaseUrl,
  getAdvertisedVersion,
  parseAdvertisedVersion,
  releaseAppcastUrl,
  releaseZipUrl,
} from "@/lib/app-release";

const ENV_KEYS = ["WRITE_RELEASE_BLOB_BASE", "BLOB_READ_WRITE_TOKEN"] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("blobBaseUrl", () => {
  it("is null with no Blob env at all", () => {
    expect(blobBaseUrl()).toBeNull();
  });

  it("derives the public origin from BLOB_READ_WRITE_TOKEN", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_Abc123XYZ_secretpart";
    expect(blobBaseUrl()).toBe("https://abc123xyz.public.blob.vercel-storage.com");
  });

  it("prefers WRITE_RELEASE_BLOB_BASE and trims trailing slashes", () => {
    process.env.WRITE_RELEASE_BLOB_BASE = "https://cdn.example.com/";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_Abc123_secret";
    expect(blobBaseUrl()).toBe("https://cdn.example.com");
  });

  it("ignores a malformed token", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "not-a-blob-token";
    expect(blobBaseUrl()).toBeNull();
  });
});

describe("fixed release URLs", () => {
  it("build the appcast and stable-zip URLs from the Blob base", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_Store9_secret";
    const base = "https://store9.public.blob.vercel-storage.com";
    expect(releaseAppcastUrl()).toBe(`${base}/downloads/appcast.xml`);
    expect(releaseZipUrl()).toBe(`${base}/downloads/Write.zip`);
  });

  it("are null without Blob config", () => {
    expect(releaseAppcastUrl()).toBeNull();
    expect(releaseZipUrl()).toBeNull();
  });
});

describe("parseAdvertisedVersion", () => {
  // The real generate_appcast element form.
  const item = (build: string, short: string) =>
    `<item><sparkle:version>${build}</sparkle:version>` +
    `<sparkle:shortVersionString>${short}</sparkle:shortVersionString></item>`;

  it("reads the build number and marketing version (element form)", () => {
    expect(parseAdvertisedVersion(item("2", "0.2"))).toEqual({
      version: "0.2",
      buildNumber: 2,
    });
  });

  it("takes the first (newest) item when several are present", () => {
    const xml = item("5", "0.5") + item("2", "0.2");
    expect(parseAdvertisedVersion(xml)).toEqual({ version: "0.5", buildNumber: 5 });
  });

  it("also accepts the attribute form", () => {
    expect(
      parseAdvertisedVersion('sparkle:version="3" sparkle:shortVersionString="0.3"'),
    ).toEqual({ version: "0.3", buildNumber: 3 });
  });

  it("falls back to the build number when the short string is absent", () => {
    expect(parseAdvertisedVersion("<sparkle:version>7</sparkle:version>")).toEqual({
      version: "7",
      buildNumber: 7,
    });
  });

  it("rejects an appcast with no usable version", () => {
    expect(parseAdvertisedVersion("<rss></rss>")).toBeNull();
    expect(parseAdvertisedVersion("<sparkle:version>0</sparkle:version>")).toBeNull();
  });
});

describe("getAdvertisedVersion", () => {
  it("resolves null without Blob config (no network)", async () => {
    await expect(getAdvertisedVersion()).resolves.toBeNull();
  });
});
