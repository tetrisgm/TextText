import { createHash } from "node:crypto";

/**
 * Identity for feed entries and feed endpoints.
 *
 * Three things that look alike and are not:
 *  - the entry's stable external key, which decides "have we seen this before"
 *    for one connection;
 *  - the canonical article URL, a hint for "is this the same document as one
 *    we already have", never proof on its own;
 *  - the endpoint key, which decides "is this the same subscription" inside a
 *    workspace, with credentials removed.
 *
 * RSS guids are opaque unless they declare themselves permalinks. Atom ids are
 * identity, not URLs to normalize. JSON Feed ids are strings. A feed with no
 * usable id falls back to a source-scoped fingerprint of permalink plus title
 * plus published time, which is stable across polls and distinct across
 * entries in practice.
 */

/** Query parameters that only ever track and never select content. */
const TRACKING_PARAMETERS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref_src",
  "_hsenc",
  "_hsmi",
  "yclid",
  "twclid",
  "s_cid",
]);

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Strip only known tracking parameters and normalize the trivial parts of a
 * URL. Fragments are kept: for a liveblog or a single-page app they can be
 * the whole address. Query order is normalized so two spellings compare
 * equal. Anything unparseable comes back unchanged and untrusted.
 */
export function canonicalizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams) {
    if (TRACKING_PARAMETERS.has(key.toLowerCase())) continue;
    kept.push([key, value]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  // A lone trailing slash on a path is the same resource on every server that
  // matters here; a trailing slash inside a deeper path is not touched.
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

/**
 * Credential-free identity of a subscription. Userinfo and secret-looking
 * query parameters are dropped so a workspace cannot end up with the same
 * feed twice under two tokens, and so the key is safe to show and to log.
 */
export function endpointKey(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.username = "";
  url.password = "";
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams) {
    if (looksLikeSecretParameter(key)) continue;
    if (TRACKING_PARAMETERS.has(key.toLowerCase())) continue;
    kept.push([key, value]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  return url.toString();
}

const SECRET_PARAMETER = /^(token|key|api_?key|auth|secret|sig|signature|access_?token|pass(word)?|pw)$/i;

export function looksLikeSecretParameter(name: string): boolean {
  return SECRET_PARAMETER.test(name);
}

/**
 * What a person sees for an endpoint. Host and path only; tokens in the path
 * are shortened, query secrets are dropped, userinfo is never shown.
 */
export function redactedEndpoint(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return "(invalid feed address)";
  }
  const path = url.pathname
    .split("/")
    .map((segment) =>
      segment.length >= 24 && /^[A-Za-z0-9_-]+$/.test(segment)
        ? `${segment.slice(0, 4)}…`
        : segment,
    )
    .join("/");
  const hadSecret = [...url.searchParams.keys()].some(looksLikeSecretParameter);
  return `${url.hostname}${path}${hadSecret || url.username ? " (private)" : ""}`;
}

export type FeedEntryIdentityInput = {
  /** RSS guid text, Atom id, or JSON Feed id. */
  id?: string | null;
  /** RSS guid isPermaLink attribute (true when absent per the RSS spec). */
  idIsPermalink?: boolean | null;
  permalink?: string | null;
  title?: string | null;
  publishedAt?: string | null;
};

/**
 * The stable per-connection key for a feed entry.
 *
 * Preference: a declared id (Atom id, JSON Feed id, or an RSS guid) is used
 * verbatim, prefixed by its kind so an RSS guid "123" and a permalink
 * ".../123" never collide. Without an id, the permalink is the key. Without
 * either, a fingerprint of title and published time, scoped by the caller to
 * the connection, is the best stable signal a broken feed can offer.
 */
export function feedEntryKey(input: FeedEntryIdentityInput): string {
  const id = input.id?.trim();
  if (id) {
    // An RSS guid that declares itself a permalink IS a URL, and is compared
    // as one so http/https and trailing-slash spellings stay one entry.
    if (input.idIsPermalink === true) {
      const canonical = canonicalizeUrl(id);
      if (canonical) return `url:${canonical}`;
    }
    return `id:${id}`;
  }
  const permalink = canonicalizeUrl(input.permalink);
  if (permalink) return `url:${permalink}`;
  const title = (input.title ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const published = input.publishedAt?.trim() ?? "";
  return `fp:${sha256(`${title}\n${published}`).slice(0, 32)}`;
}

/**
 * Whether a feed-supplied timestamp is usable. Missing and unparseable dates
 * fall back to the received time; a date far in the future is treated as
 * missing so a typo cannot pin an article to the top of every list forever.
 */
export function usableFeedDate(
  value: string | null | undefined,
  now: Date,
): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const twoDaysAhead = now.getTime() + 2 * 24 * 60 * 60 * 1000;
  if (parsed.getTime() > twoDaysAhead) return null;
  // Before the web is not a publication date either.
  if (parsed.getTime() < Date.UTC(1990, 0, 1)) return null;
  return parsed;
}
