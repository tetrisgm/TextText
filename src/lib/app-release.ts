// The Mac app release lives at FIXED Blob paths, no pointer indirection.
// Each release uploads (via scripts/publish-mac-release.mjs):
//   downloads/Write-<version>.zip  immutable, referenced by the appcast enclosure
//   downloads/Write.zip            the stable "latest" alias (overwritten)
//   downloads/appcast.xml          the signed Sparkle appcast (overwritten)
//
// The appcast IS the source of truth. /appcast.xml proxies it, /download/*
// redirect to the fixed zips, and /api/app/version parses the version out of
// the appcast. No pointer JSON, no cache, no validation layer.
//
// Degradation is a contract: no Blob env resolves to null and the routes
// answer 404, which the Mac app tolerates (Sparkle just skips the check).

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

/** Fixed Blob URL of the signed appcast, or null when Blob is not configured. */
export function releaseAppcastUrl(): string | null {
  const base = blobBaseUrl();
  return base ? `${base}/${DOWNLOADS_PREFIX}/appcast.xml` : null;
}

/** Fixed Blob URL of the stable "latest" app zip. */
export function releaseZipUrl(): string | null {
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
