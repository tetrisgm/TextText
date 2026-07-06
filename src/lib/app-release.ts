// The Mac app release pointer. The release script uploads versioned
// artifacts (the app zip, the signed Sparkle appcast, occasionally the stub
// installer zip) to Vercel Blob as immutable files, then overwrites one
// well-known JSON blob with the current release's coordinates. This module is
// the only reader; /appcast.xml, /download/*, and /api/app/version all
// resolve through it.
//
// Degradation is a contract: no Blob env, no pointer blob yet, a fetch
// failure, or a malformed pointer all resolve to null, and the routes answer
// 404. The Mac app tolerates that (Sparkle just skips the check).

export const RELEASE_POINTER_PATHNAME = "releases/mac/current.json";

/** How long a fetched (or failed) pointer read is trusted before refetching. */
const CACHE_TTL_MS = 60_000;

export interface AppRelease {
  /** Marketing version, mirrors CFBundleShortVersionString ("1.2"). */
  version: string;
  /** Monotonic CFBundleVersion; the number Sparkle actually compares. */
  buildNumber: number;
  /** Immutable versioned Blob URL of the app zip (Write-{version}.zip). */
  zipUrl: string;
  /** Blob URL of the signed Sparkle appcast for this release. */
  appcastUrl: string;
  /** Blob URL of the stub installer zip (install-write.zip), when published. */
  installerZipUrl?: string;
  /** ISO-8601 timestamp written by the release script. Informational. */
  publishedAt: string;
}

/**
 * The public Blob origin, without a trailing slash.
 *
 * WRITE_RELEASE_BLOB_BASE wins when set (dev or a future store move);
 * otherwise the origin is derived from BLOB_READ_WRITE_TOKEN, whose
 * store id segment is the public hostname's first label
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

/** Absolute URL of the pointer blob, or null when Blob is not configured. */
export function releasePointerUrl(): string | null {
  const base = blobBaseUrl();
  return base ? `${base}/${RELEASE_POINTER_PATHNAME}` : null;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function cleanHttpUrl(value: unknown): string | null {
  const raw = cleanString(value);
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol === "https:") return raw;
  // Plain http is a dev-only affordance, same rule as the app's link opener.
  const host = url.hostname.toLowerCase();
  const isLocal = host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1";
  return url.protocol === "http:" && isLocal ? raw : null;
}

function cleanBuildNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Validate a decoded pointer. Required fields must be present and
 * well-formed or the whole pointer is rejected (a broken pointer must never
 * produce a half-working download page). The optional installer URL is
 * dropped when malformed instead, since the release stands without it.
 */
export function parseAppRelease(value: unknown): AppRelease | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const version = cleanString(record.version);
  const buildNumber = cleanBuildNumber(record.buildNumber);
  const zipUrl = cleanHttpUrl(record.zipUrl);
  const appcastUrl = cleanHttpUrl(record.appcastUrl);
  const publishedAt = cleanString(record.publishedAt);
  if (!version || !buildNumber || !zipUrl || !appcastUrl || !publishedAt) return null;

  const installerZipUrl = cleanHttpUrl(record.installerZipUrl) ?? undefined;
  return { version, buildNumber, zipUrl, appcastUrl, installerZipUrl, publishedAt };
}

interface PointerCache {
  release: AppRelease | null;
  expiresAt: number;
}

let pointerCache: PointerCache | null = null;

/** Test hook: forget the cached pointer so the next read hits the network. */
export function resetAppReleaseCache(): void {
  pointerCache = null;
}

/**
 * The current Mac app release, or null when none is published (or Blob is
 * not configured, or the pointer is unreadable). Reads are cached in memory
 * for 60 seconds per server instance; failures are cached for the same
 * window so a missing pointer never turns into a request-rate fetch storm.
 */
export async function getCurrentAppRelease(): Promise<AppRelease | null> {
  const now = Date.now();
  if (pointerCache && now < pointerCache.expiresAt) return pointerCache.release;

  const release = await fetchPointer();
  pointerCache = { release, expiresAt: now + CACHE_TTL_MS };
  return release;
}

async function fetchPointer(): Promise<AppRelease | null> {
  const url = releasePointerUrl();
  if (!url) return null;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return parseAppRelease(await response.json());
  } catch {
    return null;
  }
}
