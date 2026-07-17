// The server's LIGHT bookmark capture: one cheap fetch for the page title
// and description so a fresh bookmark is presentable immediately. It always
// keeps captureStatus pending: the full capture (readable extraction,
// original HTML, screenshot) belongs to a capture agent with a real browser
// engine (the Mac app), which claims pending bookmarks via
// /api/sync/v1/captures.
//
// Deliberately regex-scraped, not a DOM parser: titles and OG tags sit in
// the first kilobytes of well-formed head sections, and a malformed page
// just yields fewer fields, never an error the user sees.

import dns from "node:dns/promises";
import net from "node:net";
import { saveBookmarkCapture } from "@/lib/store";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_REDIRECT_HOPS = 5;

/**
 * True if an IPv4 literal is in any private, loopback, link-local, CGNAT, or
 * reserved range. A malformed literal returns true (reject) rather than
 * risk letting something odd through.
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 127 || a === 10) return true; // this-host, loopback, RFC1918
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/** True if an IPv6 literal is loopback, unique-local, link-local, or maps a
 * private IPv4. Unknown shapes reject. */
export function isPrivateIPv6(ip: string): boolean {
  const norm = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (norm === "::1" || norm === "::") return true;
  if (/^f[cd]/.test(norm)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(norm)) return true; // fe80::/10 link-local
  const mapped = norm.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
}

/**
 * Cheap synchronous pre-filter: scheme, obvious loopback/local names, and
 * private IP literals. This is NOT the security boundary on its own (a name
 * like foo.localhost or 10.0.0.1.nip.io slips past a string check); the DNS
 * resolution in hostResolvesToPublicOnly is the real gate. Kept because it
 * rejects the common cases without a lookup and is unit-testable.
 */
export function isFetchableBookmarkUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") && host !== "localhost") return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local")) return false;
  if (net.isIP(host) && isPrivateIP(host)) return false;
  if (host.startsWith("[")) {
    const inner = host.slice(1, -1);
    if (net.isIPv6(inner) && isPrivateIPv6(inner)) return false;
  }
  return true;
}

/**
 * The real SSRF gate: resolve the host and require EVERY resolved address to
 * be public. This closes hostname tricks (*.localhost, nip.io, sslip.io) and
 * names that resolve to internal IPs, because they all ultimately resolve to
 * a private address. Re-run on every redirect hop. A resolution failure or
 * any private address rejects. (A determined DNS-rebinding TOCTOU between
 * this lookup and the socket connect is a known residual; acceptable for a
 * low-value note-taking fetch on serverless with no interesting loopback.)
 */
export async function hostResolvesToPublicOnly(host: string): Promise<boolean> {
  if (net.isIP(host)) return !isPrivateIP(host);
  try {
    const results = await dns.lookup(host, { all: true });
    if (results.length === 0) return false;
    return results.every((r) => !isPrivateIP(r.address));
  } catch {
    return false;
  }
}

/** Fetch one public HTTP resource while validating every redirect hop. Returning
 * null means the URL was malformed, resolved privately, or exceeded the redirect
 * limit. Callers still own timeouts, response type checks, and size limits. */
export async function fetchPublicResource(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response | null> {
  let current: URL;
  try {
    current = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    return null;
  }

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    if (!isFetchableBookmarkUrl(current)) return null;
    if (!(await hostResolvesToPublicOnly(current.hostname))) return null;
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    if (!location) return null;
    try {
      current = new URL(location, current);
    } catch {
      return null;
    }
  }
  return null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]).slice(0, 300);
  }
  return undefined;
}

export function extractPageMeta(html: string): {
  title?: string;
  description?: string;
  siteName?: string;
} {
  const head = html.slice(0, MAX_HTML_BYTES);
  const title =
    metaContent(head, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    ]) ??
    (head.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
      ? decodeEntities(head.match(/<title[^>]*>([^<]+)<\/title>/i)![1]).slice(
          0,
          300,
        )
      : undefined);
  const description = metaContent(head, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
  ]);
  const siteName = metaContent(head, [
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i,
  ]);
  return { title, description, siteName };
}

export async function lightCaptureBookmark(
  handle: string,
  postId: string,
  url: string,
): Promise<void> {
  let meta: { title?: string; description?: string; siteName?: string } = {};
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchPublicResource(url, {
        signal: controller.signal,
        headers: { accept: "text/html,*/*", "user-agent": "write-bookmark/1" },
      });
      if (!response) return;
      const type = response.headers.get("content-type") ?? "";
      if (response.ok && type.includes("html")) {
        meta = extractPageMeta(await response.text());
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // A dead or slow page is not an error state: the bookmark simply keeps
    // its hostname title until the full capture agent has a look.
    return;
  }
  if (!meta.title && !meta.description && !meta.siteName) return;
  await saveBookmarkCapture(
    handle,
    postId,
    { url, ...meta, capturedBy: "server" },
    { keepPending: true },
  );
}
