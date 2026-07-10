import { generatedAppRelease } from "@/generated/app-release";

// The Mac app release lives at immutable Blob paths selected by a generated
// manifest.
// Each release uploads (via scripts/publish-mac-release.mjs):
//   downloads/Write-<version>.zip  immutable, referenced by the appcast enclosure
//   downloads/appcast-<version>.xml immutable, proxied by /appcast.xml
// The public website deployment is the final version marker: it includes the
// generated manifest that points /appcast.xml, /download/Write.zip, and
// /api/app/version at the same immutable release.
//
// The Blob-base fallback remains for older deployments and local experiments.

const DOWNLOADS_PREFIX = "downloads";

/**
 * The public Blob origin, without a trailing slash.
 *
 * WRITE_RELEASE_BLOB_BASE wins when set (dev or a future store move);
 * otherwise the origin is derived from BLOB_READ_WRITE_TOKEN, whose store id
 * segment is the public hostname's first label
 * (vercel_blob_rw_{storeId}_{secret} -> {storeid}.public.blob.vercel-storage.com).
 */
export function blobBaseUrl(): string | null {
  const explicit = process.env.WRITE_RELEASE_BLOB_BASE?.trim().replace(/\/+$/, "");
  if (explicit) {
    try {
      const url = new URL(explicit);
      if (url.protocol === "https:" || url.protocol === "http:") return explicit;
    } catch {
      // Fall through to token derivation.
    }
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN ?? "";
  const match = token.match(/^vercel_blob_rw_([A-Za-z0-9]+)_/);
  if (!match) return null;
  return `https://${match[1].toLowerCase()}.public.blob.vercel-storage.com`;
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Current signed appcast URL, or null when no release is configured. */
export function releaseAppcastUrl(): string | null {
  if (isHttpUrl(generatedAppRelease.appcastUrl)) {
    return generatedAppRelease.appcastUrl;
  }
  const base = blobBaseUrl();
  return base ? `${base}/${DOWNLOADS_PREFIX}/appcast.xml` : null;
}

/** Current app zip URL, or null when no release is configured. */
export function releaseZipUrl(): string | null {
  if (isHttpUrl(generatedAppRelease.zipUrl)) {
    return generatedAppRelease.zipUrl;
  }
  const base = blobBaseUrl();
  return base ? `${base}/${DOWNLOADS_PREFIX}/Write.zip` : null;
}

export interface AdvertisedVersion {
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
