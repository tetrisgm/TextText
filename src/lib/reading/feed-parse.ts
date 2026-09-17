import { XMLParser } from "fast-xml-parser";
import { decodeHtmlEntities, htmlToMarkdown, htmlToText } from "./html-to-markdown";
import { feedEntryKey } from "./feed-identity";

/**
 * RSS 2.0, Atom 1.0 and JSON Feed 1.x into one normalized shape.
 *
 * Boundaries first: a document with a DOCTYPE or an entity declaration is
 * refused before the parser sees it, entity expansion is off, and every text
 * field is decoded and bounded here rather than trusted downstream. The
 * result is data about a feed, never markup from it.
 */

export type FeedFormat = "rss" | "atom" | "jsonfeed";

export type NormalizedEntry = {
  /** Stable per-feed key; see feed-identity.ts. */
  externalKey: string;
  /** The declared id, verbatim, when the feed has one. */
  declaredId: string | null;
  title: string;
  permalink: string | null;
  externalUrl: string | null;
  authors: string[];
  publishedAt: string | null;
  updatedAt: string | null;
  /** "full" when a body element was present, "excerpt" for summary only,
   * "metadata" when the entry is just a title and a link. */
  availability: "full" | "excerpt" | "metadata";
  bodyMarkdown: string;
  bodyText: string;
  excerpt: string | null;
  language: string | null;
  /** Enclosure/attachment URLs, http(s) only, never fetched by the parser. */
  attachments: Array<{ url: string; mimeType: string | null }>;
};

export type NormalizedFeed = {
  format: FeedFormat;
  title: string;
  siteUrl: string | null;
  description: string | null;
  language: string | null;
  entries: NormalizedEntry[];
  /** Entries dropped for lacking anything usable. */
  droppedEntries: number;
};

export class FeedParseError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unsupported"
      | "malformed"
      | "refused_dtd"
      | "too_large"
      | "no_entries",
  ) {
    super(message);
    this.name = "FeedParseError";
  }
}

export const MAX_FEED_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const MAX_TITLE = 1000;
const MAX_BODY = 1_000_000;
const MAX_AUTHORS = 20;

function refuseDtd(text: string): void {
  // The first kilobyte is where a prolog lives; anything declaring entities
  // anywhere is refused as well, cheaply.
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) {
    throw new FeedParseError(
      "Feeds with document type or entity declarations are not accepted",
      "refused_dtd",
    );
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: "#cdata",
  processEntities: false,
  htmlEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  // Namespaced element names stay as-is ("content:encoded"); we look them up
  // by both prefixed and local names below.
  removeNSPrefix: false,
});

type XmlNode = string | number | boolean | null | XmlObject | XmlNode[];
type XmlObject = { [key: string]: XmlNode };

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isObject(value: XmlNode | undefined): value is XmlObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Text of an element that may be a string, a CDATA wrapper, or an object. */
function textOf(node: XmlNode | undefined): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === "string") return decodeHtmlEntities(node).trim() || null;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return textOf(node[0]);
  const cdata = node["#cdata"];
  if (typeof cdata === "string") return cdata.trim() || null;
  const text = node["#text"];
  if (typeof text === "string") return decodeHtmlEntities(text).trim() || null;
  return null;
}

/** Raw (possibly HTML) content of an element, CDATA preferred, undecoded. */
function rawOf(node: XmlNode | undefined): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return rawOf(node[0]);
  if (isObject(node)) {
    const cdata = node["#cdata"];
    if (typeof cdata === "string") return cdata;
    const text = node["#text"];
    if (typeof text === "string") return text;
  }
  return null;
}

function attr(node: XmlNode | undefined, name: string): string | null {
  if (!isObject(node)) return null;
  const value = node[`@_${name}`];
  return typeof value === "string" ? value : null;
}

/** Find a child by local name, tolerating any namespace prefix. */
function child(node: XmlObject, local: string): XmlNode | undefined {
  if (node[local] !== undefined) return node[local];
  const suffix = `:${local}`;
  for (const key of Object.keys(node)) {
    if (key.endsWith(suffix)) return node[key];
  }
  return undefined;
}

function children(node: XmlObject, local: string): XmlNode[] {
  return asArray(child(node, local));
}

/**
 * Media RSS elements by their exact prefixed name.
 *
 * The prefix-insensitive lookup above cannot be used for these: asking for
 * "content" would also match content:encoded, which is the item's body, not a
 * picture. Feeds write these with the conventional prefixes.
 */
function mediaImages(node: XmlObject): Array<{ url: string; mimeType: string | null }> {
  const groups = [node, ...asArray(node["media:group"]).filter(isObject)];
  const nodes: XmlNode[] = [];
  for (const group of groups) {
    if (!isObject(group)) continue;
    nodes.push(
      ...asArray(group["media:content"]),
      ...asArray(group["media:thumbnail"]),
      ...asArray(group["itunes:image"]),
    );
  }
  return nodes
    .map((entry) => ({
      url: httpUrl(attr(entry, "url") ?? attr(entry, "href")),
      // A thumbnail declares no type and is always a picture; a media:content
      // may be a video, and its declared type is what rules it out.
      mimeType: attr(entry, "type") ?? (attr(entry, "medium") === "image" ? "image/unknown" : null),
    }))
    .filter((entry): entry is { url: string; mimeType: string | null } => entry.url !== null);
}

function clip(value: string | null, max: number): string | null {
  if (value === null) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function excerptFrom(text: string, max = 400): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut}…`;
}

type BodyResult = Pick<
  NormalizedEntry,
  "availability" | "bodyMarkdown" | "bodyText" | "excerpt"
>;

function bodyFrom(fullHtml: string | null, summaryHtml: string | null): BodyResult {
  const full = fullHtml ? clip(fullHtml, MAX_BODY) : null;
  const summary = summaryHtml ? clip(summaryHtml, MAX_BODY) : null;
  if (full) {
    const converted = htmlToMarkdown(full);
    if (converted.text) {
      const summaryText = summary ? htmlToText(summary) : null;
      return {
        availability: "full",
        bodyMarkdown: converted.markdown,
        bodyText: converted.text,
        excerpt: excerptFrom(summaryText || converted.text),
      };
    }
  }
  if (summary) {
    const converted = htmlToMarkdown(summary);
    if (converted.text) {
      return {
        availability: "excerpt",
        bodyMarkdown: converted.markdown,
        bodyText: converted.text,
        excerpt: excerptFrom(converted.text),
      };
    }
  }
  return { availability: "metadata", bodyMarkdown: "", bodyText: "", excerpt: null };
}

function finishEntry(
  partial: Omit<NormalizedEntry, "externalKey"> & { idIsPermalink?: boolean | null },
): NormalizedEntry | null {
  const title = clip(partial.title, MAX_TITLE) ?? "";
  if (!title && !partial.permalink && !partial.declaredId) return null;
  const externalKey = feedEntryKey({
    id: partial.declaredId,
    idIsPermalink: partial.idIsPermalink ?? null,
    permalink: partial.permalink,
    title,
    publishedAt: partial.publishedAt,
  });
  const { idIsPermalink: _drop, ...rest } = partial;
  void _drop;
  return { ...rest, title: title || partial.permalink || "Untitled", externalKey };
}

function parseRss(root: XmlObject): NormalizedFeed {
  const channel = asArray(child(root, "channel"))[0];
  if (!isObject(channel)) {
    throw new FeedParseError("RSS document has no channel", "malformed");
  }
  const language = textOf(child(channel, "language"));
  const entries: NormalizedEntry[] = [];
  let dropped = 0;
  for (const item of children(channel, "item").slice(0, MAX_ENTRIES)) {
    if (!isObject(item)) continue;
    const guidNode = child(item, "guid");
    const guid = textOf(guidNode);
    const isPermalinkAttr = attr(guidNode, "isPermaLink");
    // Per RSS 2.0, isPermaLink defaults to true when absent.
    const idIsPermalink =
      guid === null ? null : isPermalinkAttr === null ? true : isPermalinkAttr !== "false";
    const link = httpUrl(textOf(child(item, "link")));
    const authors = [
      ...children(item, "creator").map(textOf),
      ...children(item, "author").map(textOf),
    ]
      .filter((value): value is string => Boolean(value))
      .slice(0, MAX_AUTHORS);
    const body = bodyFrom(rawOf(child(item, "encoded")), rawOf(child(item, "description")));
    const attachments = [
      ...children(item, "enclosure")
        .map((node) => ({
          url: httpUrl(attr(node, "url")),
          mimeType: attr(node, "type"),
        }))
        .filter((a): a is { url: string; mimeType: string | null } => a.url !== null),
      ...mediaImages(item),
    ];
    const entry = finishEntry({
      declaredId: guid,
      idIsPermalink,
      title: textOf(child(item, "title")) ?? "",
      permalink: idIsPermalink && guid ? (httpUrl(guid) ?? link) : link,
      externalUrl: link,
      authors,
      publishedAt: textOf(child(item, "pubDate")) ?? textOf(child(item, "date")),
      updatedAt: null,
      language,
      attachments,
      ...body,
    });
    if (entry) entries.push(entry);
    else dropped += 1;
  }
  return {
    format: "rss",
    title: textOf(child(channel, "title")) ?? "Untitled feed",
    siteUrl: httpUrl(textOf(child(channel, "link"))),
    description: clip(textOf(child(channel, "description")), 2000),
    language,
    entries,
    droppedEntries: dropped,
  };
}

function atomLink(node: XmlObject, rel: string): string | null {
  for (const link of children(node, "link")) {
    const linkRel = attr(link, "rel") ?? "alternate";
    if (linkRel === rel) {
      const href = httpUrl(attr(link, "href"));
      if (href) return href;
    }
  }
  return null;
}

function atomText(node: XmlNode | undefined): { raw: string | null; isHtml: boolean } {
  if (node === undefined) return { raw: null, isHtml: false };
  const type = attr(node, "type") ?? "text";
  const raw = rawOf(node);
  if (raw === null) return { raw: null, isHtml: false };
  // "html" carries escaped markup; "xhtml" carries real markup we already
  // received as a tree, which this parser flattens to text - a documented
  // limit rather than a guess at reconstructing it.
  if (type === "html") return { raw: decodeHtmlEntities(raw), isHtml: true };
  if (type === "xhtml") return { raw: textOf(node), isHtml: false };
  return { raw: decodeHtmlEntities(raw), isHtml: false };
}

function parseAtom(root: XmlObject): NormalizedFeed {
  const language = attr(root, "xml:lang") ?? attr(root, "lang");
  const entries: NormalizedEntry[] = [];
  let dropped = 0;
  for (const item of children(root, "entry").slice(0, MAX_ENTRIES)) {
    if (!isObject(item)) continue;
    const id = textOf(child(item, "id"));
    const alternate = atomLink(item, "alternate");
    const related = atomLink(item, "related");
    const authors = children(item, "author")
      .map((a) => (isObject(a) ? textOf(child(a, "name")) : textOf(a)))
      .filter((value): value is string => Boolean(value))
      .slice(0, MAX_AUTHORS);
    const content = atomText(child(item, "content"));
    const summary = atomText(child(item, "summary"));
    const body = bodyFrom(
      content.raw ? (content.isHtml ? content.raw : escapeAsParagraphs(content.raw)) : null,
      summary.raw ? (summary.isHtml ? summary.raw : escapeAsParagraphs(summary.raw)) : null,
    );
    const attachments = [
      ...children(item, "link")
        .filter((link) => attr(link, "rel") === "enclosure")
        .map((link) => ({ url: httpUrl(attr(link, "href")), mimeType: attr(link, "type") }))
        .filter((a): a is { url: string; mimeType: string | null } => a.url !== null),
      ...mediaImages(item),
    ];
    const titleNode = atomText(child(item, "title"));
    const entry = finishEntry({
      declaredId: id,
      idIsPermalink: false,
      title: titleNode.isHtml ? htmlToText(titleNode.raw ?? "") : (titleNode.raw ?? ""),
      permalink: alternate,
      externalUrl: related ?? alternate,
      authors,
      publishedAt: textOf(child(item, "published")) ?? textOf(child(item, "updated")),
      updatedAt: textOf(child(item, "updated")),
      language,
      attachments,
      ...body,
    });
    if (entry) entries.push(entry);
    else dropped += 1;
  }
  const feedTitle = atomText(child(root, "title"));
  return {
    format: "atom",
    title:
      (feedTitle.isHtml ? htmlToText(feedTitle.raw ?? "") : feedTitle.raw) ?? "Untitled feed",
    siteUrl: atomLink(root, "alternate"),
    description: clip(atomText(child(root, "subtitle")).raw, 2000),
    language,
    entries,
    droppedEntries: dropped,
  };
}

/** Plain text into something the HTML converter turns into paragraphs. */
function escapeAsParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p>${paragraph.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
    )
    .join("");
}

type JsonFeedItem = {
  id?: unknown;
  url?: unknown;
  external_url?: unknown;
  title?: unknown;
  content_html?: unknown;
  content_text?: unknown;
  summary?: unknown;
  date_published?: unknown;
  date_modified?: unknown;
  language?: unknown;
  authors?: unknown;
  author?: unknown;
  attachments?: unknown;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJsonFeed(json: Record<string, unknown>): NormalizedFeed {
  const version = str(json.version) ?? "";
  if (!version.startsWith("https://jsonfeed.org/version/1")) {
    throw new FeedParseError("Not a JSON Feed document", "unsupported");
  }
  const items = Array.isArray(json.items) ? (json.items as JsonFeedItem[]) : [];
  const language = str(json.language);
  const entries: NormalizedEntry[] = [];
  let dropped = 0;
  for (const item of items.slice(0, MAX_ENTRIES)) {
    if (!item || typeof item !== "object") continue;
    const authorList = Array.isArray(item.authors)
      ? item.authors
      : item.author
        ? [item.author]
        : [];
    const authors = authorList
      .map((a) => (a && typeof a === "object" ? str((a as { name?: unknown }).name) : str(a)))
      .filter((value): value is string => Boolean(value))
      .slice(0, MAX_AUTHORS);
    const contentHtml = str(item.content_html);
    const contentText = str(item.content_text);
    const body = bodyFrom(
      contentHtml ?? (contentText ? escapeAsParagraphs(contentText) : null),
      str(item.summary) ? escapeAsParagraphs(str(item.summary)!) : null,
    );
    const attachments = (Array.isArray(item.attachments) ? item.attachments : [])
      .map((a) =>
        a && typeof a === "object"
          ? {
              url: httpUrl(str((a as { url?: unknown }).url)),
              mimeType: str((a as { mime_type?: unknown }).mime_type),
            }
          : { url: null, mimeType: null },
      )
      .filter((a): a is { url: string; mimeType: string | null } => a.url !== null);
    const id = str(item.id);
    const entry = finishEntry({
      declaredId: id,
      idIsPermalink: false,
      title: str(item.title) ?? "",
      permalink: httpUrl(str(item.url)),
      externalUrl: httpUrl(str(item.external_url)) ?? httpUrl(str(item.url)),
      authors,
      publishedAt: str(item.date_published),
      updatedAt: str(item.date_modified),
      language: str(item.language) ?? language,
      attachments,
      ...body,
    });
    if (entry) entries.push(entry);
    else dropped += 1;
  }
  return {
    format: "jsonfeed",
    title: str(json.title) ?? "Untitled feed",
    siteUrl: httpUrl(str(json.home_page_url)),
    description: clip(str(json.description), 2000),
    language,
    entries,
    droppedEntries: dropped,
  };
}

/**
 * Parse a fetched feed body. The content type is a hint; the body decides.
 * Throws FeedParseError for anything that is not a feed this code supports.
 */
export function parseFeed(body: string, contentTypeHint?: string | null): NormalizedFeed {
  if (body.length > MAX_FEED_BYTES) {
    throw new FeedParseError("Feed document is too large", "too_large");
  }
  const trimmed = body.replace(/^﻿/, "").trimStart();
  const looksJson = trimmed.startsWith("{");
  const hintJson = /json/i.test(contentTypeHint ?? "");
  if (looksJson || (hintJson && !trimmed.startsWith("<"))) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new FeedParseError("Feed JSON could not be parsed", "malformed");
    }
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw new FeedParseError("Feed JSON is not an object", "malformed");
    }
    return parseJsonFeed(json as Record<string, unknown>);
  }
  refuseDtd(trimmed);
  let root: XmlObject;
  try {
    root = parser.parse(trimmed) as XmlObject;
  } catch {
    throw new FeedParseError("Feed XML could not be parsed", "malformed");
  }
  if (!isObject(root)) throw new FeedParseError("Feed XML is empty", "malformed");
  const rss = asArray(child(root, "rss"))[0];
  if (isObject(rss)) return parseRss(rss);
  const feed = asArray(child(root, "feed"))[0];
  if (isObject(feed)) return parseAtom(feed);
  // RSS 1.0 / RDF: channel and item are siblings under rdf:RDF.
  const rdf = asArray(child(root, "RDF"))[0];
  if (isObject(rdf) && child(rdf, "item") !== undefined) {
    const channel = asArray(child(rdf, "channel"))[0];
    const synthetic: XmlObject = {
      channel: {
        ...(isObject(channel) ? channel : {}),
        item: child(rdf, "item") ?? [],
      },
    };
    const parsed = parseRss(synthetic);
    return { ...parsed, format: "rss" };
  }
  throw new FeedParseError("Not an RSS, Atom or JSON Feed document", "unsupported");
}

/**
 * Feed links advertised by an HTML page, in document order. Only the head's
 * declared alternates count; guessing paths like /feed is left to the caller,
 * who can verify them by fetching.
 */
export function discoverFeedLinks(html: string, baseUrl: string): Array<{ url: string; title: string | null; type: string }> {
  const results: Array<{ url: string; title: string | null; type: string }> = [];
  const seen = new Set<string>();
  const linkPattern = /<link\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  const head = html.slice(0, 200_000);
  while ((match = linkPattern.exec(head))) {
    const attrs = match[1];
    const rel = /\brel\s*=\s*["']?([^"'>\s]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (rel !== "alternate") continue;
    const type = /\btype\s*=\s*["']?([^"'>\s]+)/i.exec(attrs)?.[1]?.toLowerCase() ?? "";
    if (!/(rss|atom|feed\+json|json)/.test(type)) continue;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const rawHref = href?.[1] ?? href?.[2] ?? href?.[3];
    if (!rawHref) continue;
    let resolved: string;
    try {
      resolved = new URL(decodeHtmlEntities(rawHref), baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(resolved) || seen.has(resolved)) continue;
    seen.add(resolved);
    const title = /\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    results.push({
      url: resolved,
      title: title ? decodeHtmlEntities(title[1] ?? title[2] ?? "") || null : null,
      type,
    });
  }
  return results;
}
