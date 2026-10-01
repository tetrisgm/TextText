import { beforeEach, describe, expect, it, vi } from "vitest";
const manifest = vi.hoisted(() => ({ version: "1.2", buildNumber: 1200, appcastUrl: "https://downloads.example/downloads/appcast-1.2.xml", zipUrl: "https://downloads.example/downloads/TextText-1.2.zip" }));
vi.mock("@/generated/app-release", () => ({ generatedAppRelease: manifest }));
import { getAdvertisedVersion, parseAdvertisedVersion, releaseAppcastUrl, releaseZipUrl } from "@/lib/app-release";
import { generatedAppRelease } from "@/generated/app-release";
beforeEach(() => { manifest.appcastUrl = "https://downloads.example/downloads/appcast-1.2.xml"; manifest.zipUrl = "https://downloads.example/downloads/TextText-1.2.zip"; });
describe("release URLs", () => {
  it("advertises only the generated immutable release pair", () => {
    expect(releaseAppcastUrl()).toBe(manifest.appcastUrl); expect(releaseZipUrl()).toBe(manifest.zipUrl);
  });
  it.each(["https://old.public.blob.vercel-storage.com/downloads/appcast.xml", "http://downloads.example/appcast.xml", "https://user:secret@downloads.example/appcast.xml", "javascript:alert(1)"])("fails closed for unavailable or unsafe manifest URL %s", async url => {
    manifest.appcastUrl = url;
    expect(releaseAppcastUrl()).toBeNull(); expect(releaseZipUrl()).toBeNull(); expect(await getAdvertisedVersion()).toBeNull();
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
  it("uses the generated release manifest without a network fetch", async () => {
    await expect(getAdvertisedVersion()).resolves.toEqual({
      version: generatedAppRelease.version,
      buildNumber: generatedAppRelease.buildNumber,
    });
  });
});
