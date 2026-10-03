import { strToU8 } from "fflate";
import { emptyDocumentSnapshot, validateDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import type { NormalizedEntry, NormalizedFeed } from "@/lib/reading/feed-parse";
import { emptyPack, encodePack } from "@/local-vault/pack";
import { writePayload } from "@/local-vault/model";
import type { VaultFile } from "@/local-vault/bridge";

export const FEED_SUBSCRIPTION_FIELD = "texttextFeedSubscription";
export const KEPT_FEED_ENTRY_FIELD = "texttextFeedEntry";
export const READ_FEED_ENTRY_FIELD = "texttextFeedHistoryEntry";
const MARKER_VERSION = "v1";
const SECRET_QUERY = /^(token|key|api_?key|auth|secret|sig|signature|access_?token|pass(word)?|pw)$/i;

/** A subscription is an ordinary TextPack. The endpoint stays in its validated
 * document; a feed response is transient until a person keeps an entry. */
export type FeedSubscription = {
  feedURL: string;
  title: string;
  description: string | null;
  siteUrl: string | null;
  format: NormalizedFeed["format"] | null;
  topic?: string | null;
};

export function publicFeedURL(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) throw new Error("Choose a feed address up to 4096 characters.");
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new Error("Choose an HTTP or HTTPS feed address."); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password ||
      [...url.searchParams.keys()].some((name) => SECRET_QUERY.test(name))) {
    throw new Error("Choose a public HTTP or HTTPS feed address without credentials.");
  }
  url.hash = "";
  return url.href;
}

function optionalPublicURL(value: string | null | undefined): string | null {
  if (!value || value.length > 4096) return null;
  try { return publicFeedURL(value); } catch { return null; }
}

function template(id: "texttext.bookmark" | "texttext.article") {
  const found = BUILTIN_TEMPLATES.find((value) => value.id === id);
  if (!found) throw new Error(`The ${id} template is unavailable.`);
  return found;
}

function packDocument(document: DocumentSnapshot, name: string, extraFiles?: Record<string, Uint8Array>): Uint8Array {
  const selected = template(document.presentation.template.id as "texttext.bookmark" | "texttext.article");
  const file: VaultFile = {
    path: `${name}.textpack`, hash: "",
    markdown: `---\ntextTextId: ${JSON.stringify(crypto.randomUUID())}\n---\n\n`,
    templateJSON: JSON.stringify(selected),
  };
  const pack = emptyPack();
  for (const [key, bytes] of Object.entries(extraFiles ?? {})) pack.entries[pack.prefix + key] = bytes;
  return encodePack(pack, writePayload(file, validateDocumentSnapshot(document)));
}

export function createFeedSubscriptionPack(input: FeedSubscription): { title: string; bytes: Uint8Array } {
  const feedURL = publicFeedURL(input.feedURL);
  const title = input.title.trim().slice(0, 1000) || new URL(feedURL).hostname;
  const selected = template("texttext.bookmark");
  const document = emptyDocumentSnapshot({ id: selected.id, version: selected.version });
  document.content.title = title;
  document.content.body = input.description?.trim().slice(0, 2000) ?? "";
  document.content.tags = input.topic?.trim() ? [input.topic.trim().slice(0, 40)] : [];
  document.content.fields = {
    [FEED_SUBSCRIPTION_FIELD]: MARKER_VERSION,
    feedUrl: feedURL,
    ...(optionalPublicURL(input.siteUrl) ? { feedSiteUrl: optionalPublicURL(input.siteUrl)! } : {}),
    ...(input.format && ["rss", "atom", "jsonfeed"].includes(input.format) ? { feedFormat: input.format } : {}),
  };
  return { title, bytes: packDocument(document, "Feed subscription") };
}

/** Recognition is explicit; an ordinary bookmark containing a feed URL is
 * still just a bookmark. An unsupported marked definition must not be guessed. */
export function readFeedSubscription(file: Pick<VaultFile, "documentJSON">): FeedSubscription | null {
  if (!file.documentJSON) return null;
  let candidate: unknown;
  try { candidate = JSON.parse(file.documentJSON); } catch { return null; }
  if (!candidate || typeof candidate !== "object" || !("content" in candidate)) return null;
  const content = (candidate as { content?: { fields?: Record<string, unknown> } }).content;
  if (!content?.fields || !(FEED_SUBSCRIPTION_FIELD in content.fields)) return null;
  if (content.fields[FEED_SUBSCRIPTION_FIELD] !== MARKER_VERSION) throw new Error("This feed subscription uses an unsupported version.");
  const document = validateDocumentSnapshot(candidate);
  const fields = document.content.fields;
  if (typeof fields.feedUrl !== "string") throw new Error("This feed subscription has no source address.");
  const format = fields.feedFormat;
  return {
    feedURL: publicFeedURL(fields.feedUrl),
    title: document.content.title,
    description: document.content.body || null,
    siteUrl: typeof fields.feedSiteUrl === "string" ? optionalPublicURL(fields.feedSiteUrl) : null,
    format: format === "rss" || format === "atom" || format === "jsonfeed" ? format : null,
    topic: document.content.tags[0] ?? null,
  };
}

function validDate(value: string | null): string | null {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function cleanAuthor(value: string): string { return value.trim().slice(0, 200); }

export async function feedEntryHash(feedURL: string, externalKey: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(`${publicFeedURL(feedURL)}\n${externalKey}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", keyBytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Explicit Keep snapshots the selected entry into a new, portable pack. The
 * caller imports it through the normal create-only vault operation. A later
 * feed refresh cannot alter this snapshot. */
async function createFeedEntryPack(input: {
  feedURL: string; feedTitle: string; entry: NormalizedEntry; keptAt?: string; readAt?: string;
}, destination: "article" | "bookmark", kind: "kept" | "read"): Promise<{ title: string; bytes: Uint8Array }> {
  const feedURL = publicFeedURL(input.feedURL);
  const entry = input.entry;
  if (!entry || typeof entry.externalKey !== "string" || !entry.externalKey || entry.externalKey.length > 8 * 1024 * 1024 ||
      typeof entry.bodyMarkdown !== "string" || entry.bodyMarkdown.length > 2_000_000) throw new Error("This feed entry cannot be kept.");
  const recordedAt = validDate((kind === "read" ? input.readAt : input.keptAt) ?? new Date().toISOString());
  if (!recordedAt) throw new Error("The saved date is invalid.");
  const sourceURL = optionalPublicURL(entry.permalink) ?? optionalPublicURL(entry.externalUrl);
  const title = String(entry.title || "").trim().slice(0, 1000) || sourceURL || "Untitled article";
  const feedTitle = input.feedTitle.trim().slice(0, 1000) || new URL(feedURL).hostname;
  const selected = template(destination === "bookmark" ? "texttext.bookmark" : "texttext.article");
  const document = emptyDocumentSnapshot({ id: selected.id, version: selected.version });
  document.content.title = title;
  document.content.body = entry.bodyMarkdown || String(entry.excerpt ?? "").slice(0, 2000) || sourceURL || "";
  const entryHash = await feedEntryHash(feedURL, entry.externalKey);
  const authors = (Array.isArray(entry.authors) ? entry.authors : []).filter((author): author is string => typeof author === "string").slice(0, 20).map(cleanAuthor).filter(Boolean);
  const publishedAt = validDate(entry.publishedAt), updatedAt = validDate(entry.updatedAt);
  document.content.fields = {
    [kind === "read" ? READ_FEED_ENTRY_FIELD : KEPT_FEED_ENTRY_FIELD]: MARKER_VERSION,
    feedUrl: feedURL, feedTitle, feedEntryHash: entryHash,
    ...(kind === "read" ? { readAt: recordedAt } : { keptAt: recordedAt }),
    feedAvailability: ["full", "excerpt", "metadata"].includes(entry.availability) ? entry.availability : "metadata",
    ...(sourceURL ? { sourceUrl: sourceURL } : {}),
    ...(authors.length ? { authors } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
  const sourceRecord = {
    version: 1, feedURL, feedTitle, entryHash,
    declaredId: typeof entry.declaredId === "string" ? entry.declaredId.slice(0, 20_000) : null,
    permalink: sourceURL, publishedAt, updatedAt, authors,
    attachments: (Array.isArray(entry.attachments) ? entry.attachments : []).slice(0, 100).flatMap((attachment) => {
      const url = optionalPublicURL(attachment.url);
      return url ? [{ url, mimeType: typeof attachment.mimeType === "string" ? attachment.mimeType.slice(0, 200) : null }] : [];
    }),
  };
  return { title, bytes: packDocument(document, kind === "read" ? "Read feed article" : "Kept feed article", { "feed-entry.json": strToU8(JSON.stringify(sourceRecord)) }) };
}

export function createKeptFeedEntryPack(input: {
  feedURL: string; feedTitle: string; entry: NormalizedEntry; keptAt?: string;
}, destination: "article" | "bookmark" = "article") {
  return createFeedEntryPack(input, destination, "kept");
}

/** A deliberate Mark read snapshots an unsaved story in Feeds/History.
 * This never places it in Bookmarks or turns a feed refresh into a write. */
export function createReadFeedEntryPack(input: {
  feedURL: string; feedTitle: string; entry: NormalizedEntry; readAt?: string;
}) {
  return createFeedEntryPack(input, "article", "read");
}
