import { generatedAppRelease } from "@/generated/app-release";

// Signed immutable releases are selected only by the generated manifest.
// Deleted legacy Blob URLs must never be advertised as available releases.
function isReleaseUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      !url.hostname.toLowerCase().endsWith(".blob.vercel-storage.com");
  } catch { return false; }
}
function hasRelease(): boolean {
  return isReleaseUrl(generatedAppRelease.appcastUrl) && isReleaseUrl(generatedAppRelease.zipUrl);
}
export function releaseAppcastUrl(): string | null { return hasRelease() ? generatedAppRelease.appcastUrl : null; }
export function releaseZipUrl(): string | null { return hasRelease() ? generatedAppRelease.zipUrl : null; }

interface AdvertisedVersion {
  /** marketing version (CFBundleShortVersionString), e.g. "0.2" */
  version: string;
  /** CFBundleVersion, the number Sparkle compares */
  buildNumber: number;
}

/**
 * Parse the newest release's version out of a Sparkle appcast. generate_appcast
 * writes the newest item first, so the first sparkle:version wins. Returns null
 * if the appcast has no usable version.
 */
export function parseAdvertisedVersion(appcastXml: string): AdvertisedVersion | null {
  // generate_appcast emits the element form (<sparkle:version>2</...>); the
  // attribute form (sparkle:version="2") is accepted too for robustness.
  const build =
    appcastXml.match(/<sparkle:version>(\d+)<\/sparkle:version>/) ??
    appcastXml.match(/sparkle:version="(\d+)"/);
  if (!build) return null;
  const buildNumber = Number(build[1]);
  if (!Number.isInteger(buildNumber) || buildNumber <= 0) return null;
  const short =
    appcastXml.match(
      /<sparkle:shortVersionString>([^<]+)<\/sparkle:shortVersionString>/,
    ) ?? appcastXml.match(/sparkle:shortVersionString="([^"]+)"/);
  const version = short?.[1]?.trim() || String(buildNumber);
  return { version, buildNumber };
}

/** The advertised version, read from the live appcast, or null. */
export async function getAdvertisedVersion(): Promise<AdvertisedVersion | null> {
  if (!hasRelease()) return null;
  if (
    generatedAppRelease.version &&
    Number.isInteger(generatedAppRelease.buildNumber) &&
    generatedAppRelease.buildNumber > 0
  ) {
    return {
      version: generatedAppRelease.version,
      buildNumber: generatedAppRelease.buildNumber,
    };
  }
  const url = releaseAppcastUrl();
  if (!url) return null;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return parseAdvertisedVersion(await response.text());
  } catch {
    return null;
  }
}
