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

import { saveBookmarkCapture } from "@/lib/store";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 512 * 1024;

/**
 * SSRF floor for the server-side fetch: refuse loopback, link-local, RFC1918
 * literals, and bare hostnames. (The Mac capture agent runs on the owner's
 * own machine and has no such restriction.)
 */
export function isFetchableBookmarkUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") && host !== "localhost") return false;
  if (host === "localhost" || host.endsWith(".local")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
  }
  if (host === "::1" || host.startsWith("[")) return false;
  return true;
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
    if (!isFetchableBookmarkUrl(new URL(url))) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "text/html,*/*", "user-agent": "write-bookmark/1" },
    });
    clearTimeout(timer);
    const type = response.headers.get("content-type") ?? "";
    if (response.ok && type.includes("html")) {
      meta = extractPageMeta(await response.text());
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
