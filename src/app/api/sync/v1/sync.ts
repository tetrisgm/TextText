// Pure helpers for the sync API v1: JSON errors, RFC 9110 conditional-request
// matchers, and manifest item building. Nothing here touches the database, so
// all of it is unit-testable; the auth/workspace glue lives in ./auth.ts.

import { blogBaseUrl, postUrl } from "@/lib/agent-surface";
import type { Blog, Folder, Post } from "@/lib/content";
import { markdownFileHash } from "@/lib/content-hash";
import {
  renderFolderManifest,
  renderPostMarkdownFile,
  type MarkdownFolderItem,
  type RenderFolderManifestOptions,
} from "@/lib/markdown-files";

export const WORKSPACE_SCHEMA = "write.workspace.v1";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Every sync API error is a JSON {error} with the right status. */
export function syncError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

// The savePost failures a client can fix by editing its file (message strings
// owned by src/lib/store.ts). Anything else, e.g. a transient driver error,
// must NOT map to a 4xx: the client would treat the file as rejected instead
// of retrying, and the raw message would leak internals.
const CLIENT_SAVE_ERRORS = new Set(["That URL is already used"]);

/** The friendly message when a save failure is the client's to fix, else null. */
export function clientSaveError(error: unknown): string | null {
  if (error instanceof Error && CLIENT_SAVE_ERRORS.has(error.message)) {
    return error.message;
  }
  return null;
}

// RFC 9110 13.1.1: If-Match uses the STRONG comparison, so a W/ prefixed
// candidate never matches our strong hash ETags. "*" matches any current
// representation. As a courtesy to simple sync clients the bare unquoted hash
// is accepted too.
export function ifMatchSatisfied(headerValue: string, etag: string): boolean {
  if (headerValue.trim() === "*") return true;
  // Our ETag is a content HASH, so a proxy-weakened validator denotes the SAME
  // content and must not fail a legitimate write. Normalize to the bare hash,
  // tolerating the RFC weak form W/"hash" (Vercel emits this when it gzips the
  // GET the client hashed against) AND "W/hash" (a client that stripped the
  // quotes before the weak prefix). Without this, the File Provider's
  // fetched-version If-Match spuriously conflicts on compressed reads.
  const target = normalizeEtag(etag);
  return headerValue.split(",").some((candidate) => normalizeEtag(candidate) === target);
}

/** Reduce an ETag / If-Match token to its bare content hash: drop surrounding
 * quotes and any weak `W/` prefix, whichever side of the quotes it sits on. */
function normalizeEtag(value: string): string {
  return value
    .trim()
    .replace(/^W\//, "")
    .replace(/^"(.*)"$/, "$1")
    .replace(/^W\//, "");
}

// RFC 9110 13.1.2: If-None-Match uses the WEAK comparison, so a
// proxy-weakened W/"hash" (nginx does this when it gzips) still revalidates,
// and a bare "*" matches any current representation.
export function ifNoneMatchSatisfied(headerValue: string, etag: string): boolean {
  if (headerValue.trim() === "*") return true;
  return headerValue
    .split(",")
    .some((candidate) => candidate.trim().replace(/^W\//, "") === etag);
}

/** Path of a post's markdown file on this API. */
export function syncFileUrl(postId: string): string {
  return `/api/sync/v1/files/${postId}`;
}

/**
 * A post's markdown file exactly as GET files/{id} serves it (public canonical
 * URL baked in) plus its content hash, the ETag/If-Match currency.
 */
export function renderSyncFile(
  blog: Blog,
  post: Post,
): { text: string; hash: string } {
  const text = renderPostMarkdownFile({
    blog,
    canonicalUrl: postUrl(blogBaseUrl(blog), post.slug),
    post,
    syncRevision: post.revision,
  });
  return { text, hash: markdownFileHash(text) };
}

export function syncManifestOptions(
  blog: Blog,
  folder?: Folder,
): RenderFolderManifestOptions {
  const baseUrl = blogBaseUrl(blog);
  return {
    folder,
    fileUrlFor: (post) => syncFileUrl(post.id ?? post.slug),
    postUrlFor: (post) => postUrl(baseUrl, post.slug),
    renderFileFor: (post) => renderSyncFile(blog, post).text,
  };
}

/** One manifest v2 entry for a post, as PUT/POST return it. */
export function syncManifestItem(blog: Blog, post: Post): MarkdownFolderItem {
  return renderFolderManifest(blog, [post], syncManifestOptions(blog)).items[0];
}
