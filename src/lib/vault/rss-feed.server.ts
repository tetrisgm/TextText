import { createHash } from "node:crypto";
import { isFetchableBookmarkUrl } from "@/lib/bookmark-fetch";
import { discoverFeedCandidates, fetchFeedDocument } from "@/lib/reading/fetch.server";
import { FeedParseError, parseFeed, type NormalizedEntry, type NormalizedFeed } from "@/lib/reading/feed-parse";
import { publicFeedURL } from "./rss";

const MAX_RETURNED_ENTRIES = 100;
const MAX_RESPONSE_BYTES = 2_000_000;
const responseBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export class VaultFeedError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "VaultFeedError"; }
}

function validatedAddress(input: string): string {
  const address = input.trim();
  const withScheme = /^https?:\/\//i.test(address) ? address : `https://${address}`;
  let url: URL;
  try { url = new URL(publicFeedURL(withScheme)); }
  catch { throw new VaultFeedError("Choose a public HTTP or HTTPS address without credentials.", 400); }
  if (!isFetchableBookmarkUrl(url)) throw new VaultFeedError("Choose a public feed address.", 400);
  return url.href;
}

function safeLink(value: string | null): string | null {
  if (!value) return null;
  try { return publicFeedURL(value); } catch { return null; }
}

function stableExternalKey(entry: NormalizedEntry): string {
  return entry.externalKey.length > 2048
    ? `hash:${createHash("sha256").update(entry.externalKey).digest("hex")}` : entry.externalKey;
}

function safeEntry(entry: NormalizedEntry): NormalizedEntry {
  return {
    ...entry, externalKey: stableExternalKey(entry),
    declaredId: entry.declaredId?.slice(0, 20_000) ?? null,
    permalink: safeLink(entry.permalink), externalUrl: safeLink(entry.externalUrl),
    bodyText: entry.bodyText.slice(0, 4000),
    authors: entry.authors.slice(0, 20).map((author) => author.slice(0, 200)),
    publishedAt: entry.publishedAt?.slice(0, 100) ?? null,
    updatedAt: entry.updatedAt?.slice(0, 100) ?? null,
    attachments: entry.attachments.slice(0, 100).flatMap((attachment) => {
      const url = safeLink(attachment.url);
      return url ? [{ url, mimeType: attachment.mimeType?.slice(0, 200) ?? null }] : [];
    }),
  };
}

export type VaultFeedPreview = {
  externalKey: string; title: string; permalink: string | null; externalUrl: string | null;
  authors: string[]; publishedAt: string | null; updatedAt: string | null;
  availability: NormalizedEntry["availability"]; excerpt: string | null; bodyPreview: string;
};

function previewEntry(entry: NormalizedEntry): VaultFeedPreview {
  return {
    externalKey: stableExternalKey(entry), title: entry.title.slice(0, 1000),
    permalink: safeLink(entry.permalink), externalUrl: safeLink(entry.externalUrl),
    authors: entry.authors.slice(0, 3).map((author) => author.slice(0, 100)),
    publishedAt: entry.publishedAt?.slice(0, 100) ?? null,
    updatedAt: entry.updatedAt?.slice(0, 100) ?? null,
    availability: entry.availability, excerpt: entry.excerpt?.slice(0, 400) ?? null,
    bodyPreview: entry.bodyMarkdown.slice(0, 512),
  };
}

/** Discovery verifies candidates with the existing SSRF-gated fetcher. It has
 * no persistence and never treats an unverified guessed path as a subscription. */
export async function discoverVaultFeeds(address: string) {
  const url = validatedAddress(address);
  const discovered = await discoverFeedCandidates(url);
  const candidates = discovered.candidates.filter((candidate) => candidate.verified && safeLink(candidate.url)).slice(0, 8)
    .map((candidate) => ({ url: safeLink(candidate.url)!, title: candidate.title.slice(0, 1000),
      format: candidate.format, verified: true, entryCount: Math.min(1000, Math.max(0, candidate.entryCount || 0)),
      sampleTitles: candidate.sampleTitles?.slice(0, 3).map((title) => title.slice(0, 1000)) ?? [],
      siteUrl: safeLink(candidate.siteUrl), detail: null }));
  return { pageTitle: discovered.pageTitle?.slice(0, 1000) ?? null, candidates,
    detail: candidates.length ? null : "No supported public feed was found at this address." };
}

async function loadFeed(feedURL: string): Promise<{ url: string; feed: NormalizedFeed }> {
  const url = validatedAddress(feedURL);
  const fetched = await fetchFeedDocument(url);
  if (fetched.kind === "not_modified") throw new VaultFeedError("The feed did not return a new document. Retry the refresh.", 502);
  if (fetched.kind === "error") {
    const message = ({ blocked: "Choose a public feed address.", timeout: "The feed did not answer in time.",
      too_large: "This feed is too large to read.", network: "The feed could not be reached.",
      auth_required: "This feed requires sign-in.", not_found: "The feed could not be found.",
      rate_limited: "The publisher asked us to slow down.", server_error: "The publisher is unavailable.",
      http: "The publisher did not return a feed." })[fetched.reason];
    throw new VaultFeedError(message, fetched.reason === "blocked" ? 400 : fetched.reason === "timeout" ? 504 : 502);
  }
  let feed: NormalizedFeed;
  try { feed = parseFeed(fetched.body, fetched.contentType); }
  catch (error) {
    if (error instanceof FeedParseError) throw new VaultFeedError("This address did not return a supported RSS, Atom, or JSON Feed.", 422);
    throw error;
  }
  return { url, feed };
}

/** Lists contain previews only. A separate, explicit entry read supplies the
 * full source Markdown when Keep is chosen. */
export async function readVaultFeed(feedURL: string): Promise<{
  feedURL: string; fetchedAt: string; title: string; siteUrl: string | null;
  description: string | null; format: NormalizedFeed["format"];
  entries: VaultFeedPreview[]; availableCount: number; truncated: boolean;
}> {
  const { url, feed } = await loadFeed(feedURL);
  const result = {
    feedURL: url, fetchedAt: new Date().toISOString(), title: feed.title.slice(0, 1000),
    siteUrl: safeLink(feed.siteUrl), description: feed.description?.slice(0, 2000) ?? null,
    format: feed.format, entries: [] as VaultFeedPreview[],
    availableCount: feed.entries.length, truncated: false,
  };
  let used = responseBytes(result) + 1024;
  for (const entry of feed.entries.slice(0, MAX_RETURNED_ENTRIES)) {
    const preview = previewEntry(entry);
    const size = responseBytes(preview) + 1;
    if (used + size > MAX_RESPONSE_BYTES) break;
    result.entries.push(preview);
    used += size;
  }
  result.truncated = result.entries.length < feed.entries.length;
  return result;
}

/** Re-fetches through the same public-address gate. A missing key fails
 * closed instead of turning a stale preview into a partial kept article. */
export async function readVaultFeedEntry(feedURL: string, externalKey: string): Promise<{
  feedURL: string; feedTitle: string; fetchedAt: string; entry: NormalizedEntry;
}> {
  if (typeof externalKey !== "string" || !externalKey || externalKey.length > 2048) {
    throw new VaultFeedError("Choose a feed entry from the current list.", 400);
  }
  const { url, feed } = await loadFeed(feedURL);
  const found = feed.entries.find((entry) => stableExternalKey(entry) === externalKey);
  if (!found) throw new VaultFeedError("This entry is no longer in the feed. Refresh the list.", 404);
  const result = { feedURL: url, feedTitle: feed.title.slice(0, 1000), fetchedAt: new Date().toISOString(), entry: safeEntry(found) };
  if (responseBytes(result) > MAX_RESPONSE_BYTES) throw new VaultFeedError("This entry is too large to keep from its feed.", 413);
  return result;
}
