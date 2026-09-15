import { fetchPublicResource, isFetchableBookmarkUrl } from "@/lib/bookmark-fetch";
import {
  FeedParseError,
  MAX_FEED_BYTES,
  discoverFeedLinks,
  parseFeed,
  type NormalizedFeed,
} from "./feed-parse";

/**
 * The one way a feed document reaches this process.
 *
 * Every hop goes through the same public-only gate the bookmark capture uses
 * (no loopback, no private ranges, DNS checked), with a deadline, a byte
 * ceiling read as a stream so a hostile server cannot make the process hold
 * a gigabyte, and conditional headers so an unchanged feed costs one 304.
 */

const FEED_TIMEOUT_MS = 15_000;
const USER_AGENT = "texttext-reader/1 (+https://texttext.app)";

export type FeedFetchOutcome =
  | {
      kind: "ok";
      status: number;
      body: string;
      contentType: string | null;
      etag: string | null;
      lastModified: string | null;
      finalUrl: string;
    }
  | { kind: "not_modified" }
  | {
      kind: "error";
      reason:
        | "blocked"
        | "timeout"
        | "too_large"
        | "network"
        | "auth_required"
        | "not_found"
        | "rate_limited"
        | "server_error"
        | "http";
      status: number | null;
      detail: string;
    };

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<{ text: string } | { tooLarge: true }> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true };
  const reader = response.body?.getReader();
  if (!reader) return { text: await response.text() };
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(merged) };
}

export async function fetchFeedDocument(
  url: string,
  options: {
    etag?: string | null;
    lastModified?: string | null;
    maxBytes?: number;
    timeoutMs?: number;
    accept?: string;
  } = {},
): Promise<FeedFetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FEED_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      accept:
        options.accept ??
        "application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml, text/xml, text/html;q=0.5, */*;q=0.1",
      "user-agent": USER_AGENT,
    };
    if (options.etag) headers["if-none-match"] = options.etag;
    if (options.lastModified) headers["if-modified-since"] = options.lastModified;
    let response: Response | null;
    try {
      response = await fetchPublicResource(url, { headers, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        return { kind: "error", reason: "timeout", status: null, detail: "The feed did not answer in time" };
      }
      return {
        kind: "error",
        reason: "network",
        status: null,
        detail: error instanceof Error ? error.message : "Network error",
      };
    }
    if (!response) {
      // The gate answers null for a private or unfetchable address, and also
      // for a lookup that failed or a redirect chain it would not follow. Only
      // the first is a fact about the address; the rest are this attempt's,
      // and a feed must not be marked unsupported because DNS blinked once.
      let parsed: URL | null = null;
      try {
        parsed = new URL(url);
      } catch {
        parsed = null;
      }
      if (!parsed || !isFetchableBookmarkUrl(parsed)) {
        return { kind: "error", reason: "blocked", status: null, detail: "That address is not a public feed address" };
      }
      return {
        kind: "error",
        reason: "network",
        status: null,
        detail: "The feed's address could not be resolved or followed this time",
      };
    }
    if (response.status === 304) return { kind: "not_modified" };
    if (response.status === 401 || response.status === 403) {
      return { kind: "error", reason: "auth_required", status: response.status, detail: "The feed needs sign-in" };
    }
    if (response.status === 404 || response.status === 410) {
      return { kind: "error", reason: "not_found", status: response.status, detail: "The feed is gone" };
    }
    if (response.status === 429) {
      return { kind: "error", reason: "rate_limited", status: 429, detail: "The publisher asked us to slow down" };
    }
    if (response.status >= 500) {
      return { kind: "error", reason: "server_error", status: response.status, detail: `The publisher answered ${response.status}` };
    }
    if (!response.ok) {
      return { kind: "error", reason: "http", status: response.status, detail: `The publisher answered ${response.status}` };
    }
    const read = await readBounded(response, options.maxBytes ?? MAX_FEED_BYTES);
    if ("tooLarge" in read) {
      return { kind: "error", reason: "too_large", status: response.status, detail: "The feed document is too large" };
    }
    return {
      kind: "ok",
      status: response.status,
      body: read.text,
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      finalUrl: response.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

export type FeedCandidate = {
  url: string;
  title: string;
  format: NormalizedFeed["format"] | null;
  /** Fetched and parsed: this is a feed. Unverified candidates are only hints. */
  verified: boolean;
  entryCount: number;
  sampleTitles: string[];
  siteUrl: string | null;
  detail: string | null;
};

const CONVENTIONAL_PATHS = ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml"];
const MAX_VERIFY = 6;

function asHttpUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function verifyCandidate(url: string, title: string | null): Promise<FeedCandidate> {
  const fetched = await fetchFeedDocument(url);
  if (fetched.kind !== "ok") {
    return {
      url,
      title: title ?? url,
      format: null,
      verified: false,
      entryCount: 0,
      sampleTitles: [],
      siteUrl: null,
      detail: fetched.kind === "error" ? fetched.detail : "Not modified",
    };
  }
  try {
    const feed = parseFeed(fetched.body, fetched.contentType);
    return {
      url: fetched.finalUrl,
      title: feed.title || title || url,
      format: feed.format,
      verified: true,
      entryCount: feed.entries.length,
      sampleTitles: feed.entries.slice(0, 3).map((entry) => entry.title),
      siteUrl: feed.siteUrl,
      detail: null,
    };
  } catch (error) {
    return {
      url,
      title: title ?? url,
      format: null,
      verified: false,
      entryCount: 0,
      sampleTitles: [],
      siteUrl: null,
      detail: error instanceof FeedParseError ? error.message : "Not a feed",
    };
  }
}

/**
 * Turn what a person typed into verified feed candidates. A direct feed URL
 * yields one verified candidate; a site yields its advertised alternates,
 * each verified by fetching; a site that advertises nothing has a handful of
 * conventional paths tried, and only the ones that actually parse are
 * offered. Nothing is invented.
 */
export async function discoverFeedCandidates(input: string): Promise<{
  candidates: FeedCandidate[];
  pageTitle: string | null;
  detail: string | null;
}> {
  const url = asHttpUrl(input);
  if (!url) return { candidates: [], pageTitle: null, detail: "Enter a web address" };
  const fetched = await fetchFeedDocument(url);
  if (fetched.kind !== "ok") {
    return {
      candidates: [],
      pageTitle: null,
      detail: fetched.kind === "error" ? fetched.detail : "The address did not answer",
    };
  }
  // Is it a feed already?
  try {
    const feed = parseFeed(fetched.body, fetched.contentType);
    return {
      candidates: [
        {
          url: fetched.finalUrl,
          title: feed.title,
          format: feed.format,
          verified: true,
          entryCount: feed.entries.length,
          sampleTitles: feed.entries.slice(0, 3).map((entry) => entry.title),
          siteUrl: feed.siteUrl,
          detail: null,
        },
      ],
      pageTitle: null,
      detail: null,
    };
  } catch {
    // Not a feed; treat as a page.
  }
  const pageTitle =
    /<title[^>]*>([^<]{1,300})<\/title>/i.exec(fetched.body)?.[1]?.trim() ?? null;
  const advertised = discoverFeedLinks(fetched.body, fetched.finalUrl).slice(0, MAX_VERIFY);
  const candidates: FeedCandidate[] = [];
  const seen = new Set<string>();
  for (const link of advertised) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    candidates.push(await verifyCandidate(link.url, link.title));
  }
  if (candidates.some((candidate) => candidate.verified)) {
    return { candidates, pageTitle, detail: null };
  }
  const base = new URL(fetched.finalUrl);
  for (const path of CONVENTIONAL_PATHS) {
    if (candidates.length >= MAX_VERIFY) break;
    const guess = new URL(path, `${base.protocol}//${base.host}`).toString();
    if (seen.has(guess)) continue;
    seen.add(guess);
    const verified = await verifyCandidate(guess, null);
    if (verified.verified) candidates.push(verified);
  }
  return {
    candidates,
    pageTitle,
    detail: candidates.some((candidate) => candidate.verified)
      ? null
      : "This site does not offer a feed we support. You can still save the page as a bookmark.",
  };
}
