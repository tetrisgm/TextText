// Pure helpers for the sync API v1: JSON errors, RFC 9110 conditional-request
// matchers, and manifest item building. Nothing here touches the database, so
// all of it is unit-testable; the auth/workspace glue lives in ./auth.ts.

import { blogBaseUrl, locatedPostUrl } from "@/lib/agent-surface";
import type { TemplateReference } from "@/lib/documents/model";
import type { AuthoringSource } from "@/lib/presentation/authoring-source";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import {
  getDocumentTemplateAuthoringSourcesForHandle,
  getDocumentTemplateForHandle,
  getFolderById,
} from "@/lib/store";
import {
  BLOG_FOLDER_PATH,
  DEFAULT_FILE_REPRESENTATION,
  isFileRepresentation,
} from "@/lib/content";
import type { Blog, FileRepresentation, Folder, Post } from "@/lib/content";
import { markdownFileHash } from "@/lib/content-hash";
import {
  renderSyncDocumentEnvelope,
  serializeSyncDocumentEnvelope,
} from "@/lib/documents/sync";
import {
  renderFolderManifest,
  renderPostMarkdownFile,
  type MarkdownFolderItem,
  type RenderFolderManifestOptions,
} from "@/lib/markdown-files";

export const WORKSPACE_SCHEMA = "texttext.workspace.v1";
export const TEXTTEXT_FILE_REPRESENTATION_HEADER =
  "TextText-File-Representation";
export const MAX_SYNC_METADATA_BODY_BYTES = 32 * 1024;

const SYNC_FILE_EXTENSIONS: Record<FileRepresentation, string> = {
  textbundle: ".textbundle",
  markdown: ".md",
  text: ".txt",
  textpack: ".textpack",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Parse the immutable representation selected by a sync create. */
export function parseSyncFileRepresentation(
  headerValue: string | null,
): FileRepresentation | null {
  // Before this header existed, every sync create represented an external
  // Markdown file. Preserve that behavior for older clients.
  if (headerValue === null) return "markdown";
  const value = headerValue.trim();
  return isFileRepresentation(value) ? value : null;
}

/** Every sync API error is a JSON {error} with the right status. */
export function syncError(
  status: number,
  error: string,
  headers?: HeadersInit,
): Response {
  return Response.json({ error }, { status, headers });
}

const TRANSIENT_DATABASE_MESSAGE =
  /data transfer quota|temporarily unavailable|connection (?:refused|terminated)|fetch failed/i;

/**
 * Turn a retryable database outage into a stable sync response without leaking
 * driver details. Unknown failures stay exceptional so programming errors are
 * still visible instead of being mislabeled as infrastructure trouble.
 */
export function syncDatabaseUnavailable(error: unknown): Response | null {
  const candidate =
    typeof error === "object" && error !== null
      ? (error as {
          status?: unknown;
          statusCode?: unknown;
          retryable?: unknown;
          message?: unknown;
        })
      : null;
  const status = Number(candidate?.status ?? candidate?.statusCode);
  const message =
    typeof candidate?.message === "string" ? candidate.message : String(error);
  const retryable =
    candidate?.retryable === true ||
    status === 402 ||
    status === 429 ||
    status >= 500 ||
    TRANSIENT_DATABASE_MESSAGE.test(message);

  if (!retryable) return null;
  return syncError(503, "Sync is temporarily unavailable", {
    "Cache-Control": "no-store",
    "Retry-After": "300",
  });
}

/**
 * The changes feed is a retry loop, not a data mutation. Any failure can be
 * retried safely, so keep connected clients on their bounded backoff path even
 * when a new server failure does not match the known database signatures.
 */
export function syncChangePollUnavailable(error: unknown): Response {
  return (
    syncDatabaseUnavailable(error) ??
    syncError(503, "Sync is temporarily unavailable", {
      "Cache-Control": "no-store",
      "Retry-After": "30",
    })
  );
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
  return headerValue
    .split(",")
    .some((candidate) => normalizeEtag(candidate) === target);
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
export function ifNoneMatchSatisfied(
  headerValue: string,
  etag: string,
): boolean {
  if (headerValue.trim() === "*") return true;
  return headerValue
    .split(",")
    .some((candidate) => candidate.trim().replace(/^W\//, "") === etag);
}

/** Path of a post's markdown file on this API. */
export function syncFileUrl(postId: string): string {
  return `/api/sync/v1/files/${postId}`;
}

function syncFileRepresentation(
  post: Pick<Post, "representation">,
): FileRepresentation {
  return post.representation ?? DEFAULT_FILE_REPRESENTATION;
}

/** Local path advertised only by sync manifests. */
export function syncFilePath(
  post: Pick<Post, "slug" | "representation">,
): string {
  const representation = syncFileRepresentation(post);
  return `posts/${post.slug}${SYNC_FILE_EXTENSIONS[representation]}`;
}

/**
 * A post's markdown file exactly as GET files/{id} serves it (public canonical
 * URL baked in) plus its content hash, the ETag/If-Match currency.
 */
export function renderSyncFile(
  blog: Blog,
  post: Post,
  folderPath = BLOG_FOLDER_PATH,
): { text: string; hash: string } {
  const text = renderPostMarkdownFile({
    blog,
    canonicalUrl: locatedPostUrl(blogBaseUrl(blog), { folderPath, post }),
    post,
    syncRevision: post.revision,
  });
  return { text, hash: markdownFileHash(text) };
}

/**
 * The complete `.textbundle` / `.textpack` source. The legacy Markdown hash
 * remains stable for old clients, while package-aware clients use this second
 * validator so presentation-only edits cannot disappear during sync.
 */
export function renderSyncDocumentFile(
  blog: Blog,
  post: Post,
  folderPath = BLOG_FOLDER_PATH,
  template?: TemplateDefinition | null,
  templateAuthoringSource?: AuthoringSource | null,
): { text: string; hash: string } {
  const markdown = renderSyncFile(blog, post, folderPath).text;
  const text = serializeSyncDocumentEnvelope(
    renderSyncDocumentEnvelope({ markdown, post, template, templateAuthoringSource }),
  );
  return { text, hash: markdownFileHash(text) };
}

/**
 * The looks a set of posts is pinned to, one lookup per distinct version.
 *
 * The manifest renders every post in a folder, and resolving per post would
 * mean a query per item for what is nearly always the same two or three looks.
 */
export async function templatesForPosts(
  handle: string,
  posts: readonly Post[],
): Promise<Map<string, TemplateDefinition>> {
  const wanted = new Map<string, TemplateReference>();
  for (const post of posts) {
    const reference = (post.document as { presentation?: { template?: TemplateReference } } | null)
      ?.presentation?.template;
    if (reference) wanted.set(`${reference.id}@${reference.version}`, reference);
  }
  const resolved = new Map<string, TemplateDefinition>();
  await Promise.all(
    [...wanted].map(async ([key, reference]) => {
      const definition = await getDocumentTemplateForHandle(handle, reference);
      if (definition) resolved.set(key, definition);
    }),
  );
  return resolved;
}

/** The look for one post, out of a map built by templatesForPosts. */
export function templateForPost(
  post: Post,
  templates: Map<string, TemplateDefinition>,
): TemplateDefinition | null {
  const reference = (post.document as { presentation?: { template?: TemplateReference } } | null)
    ?.presentation?.template;
  if (!reference) return null;
  return templates.get(`${reference.id}@${reference.version}`) ?? null;
}

/** Reopenable sources for the resolved looks, fetched once per distinct look. */
export async function templateAuthoringSourcesForPosts(
  handle: string,
  templates: ReadonlyMap<string, TemplateDefinition>,
): Promise<Map<string, AuthoringSource>> {
  return getDocumentTemplateAuthoringSourcesForHandle(handle, templates);
}

export function templateAuthoringSourceForPost(
  post: Post,
  sources: ReadonlyMap<string, AuthoringSource>,
): AuthoringSource | null {
  const reference = (post.document as { presentation?: { template?: TemplateReference } } | null)
    ?.presentation?.template;
  if (!reference) return null;
  return sources.get(`${reference.id}@${reference.version}`) ?? null;
}

/** Resolve both parts together so a file hash always includes the same data. */
export async function syncTemplateForPost(handle: string, post: Post): Promise<{
  template: TemplateDefinition | null;
  authoringSource: AuthoringSource | null;
}> {
  const templates = await templatesForPosts(handle, [post]);
  const sources = await templateAuthoringSourcesForPosts(handle, templates);
  return {
    template: templateForPost(post, templates),
    authoringSource: templateAuthoringSourceForPost(post, sources),
  };
}

/**
 * Whether the client's validator matches the file the server would serve NOW.
 *
 * The comparison must render with exactly the inputs GET renders with: the
 * post's real folder path and its inlined look. This used to render with the
 * Blog default path and no template, so for a document pinned to a look the
 * validator a client faithfully carried from GET could never match, every
 * guarded write or delete answered 412, and the File Provider refused to
 * materialize the document ("assets changed during materialization"): the
 * hash it fetched disagreed with the hash the artifacts manifest computed.
 */
export function ifMatchSatisfiedForSyncFile(
  headerValue: string,
  blog: Blog,
  post: Post,
  folderPath = BLOG_FOLDER_PATH,
  template?: TemplateDefinition | null,
  templateAuthoringSource?: AuthoringSource | null,
): boolean {
  const markdown = renderSyncFile(blog, post, folderPath);
  const document = renderSyncDocumentFile(blog, post, folderPath, template, templateAuthoringSource);
  return (
    ifMatchSatisfied(headerValue, `"${markdown.hash}"`) ||
    ifMatchSatisfied(headerValue, `"${document.hash}"`)
  );
}

function syncManifestOptions(
  blog: Blog,
  folder?: Folder,
): RenderFolderManifestOptions {
  const baseUrl = blogBaseUrl(blog);
  return {
    folder,
    hashFor: markdownFileHash,
    fileUrlFor: (post) => syncFileUrl(post.id ?? post.slug),
    postUrlFor: (post) =>
      locatedPostUrl(baseUrl, {
        folderPath: folder?.path ?? BLOG_FOLDER_PATH,
        post,
      }),
    renderFileFor: (post) =>
      renderSyncFile(blog, post, folder?.path ?? BLOG_FOLDER_PATH).text,
  };
}

type SyncManifestItem = MarkdownFolderItem & {
  spotlightEligible: boolean;
  representation: FileRepresentation;
  /** Hash of the complete structured document envelope for package clients. */
  documentHash: string;
  /** UTF-8 size of the complete structured document envelope. */
  documentSize: number;
};

/**
 * Add the persisted local representation to a sync manifest without changing
 * the shared public Markdown manifest renderer.
 */
export function renderSyncFolderManifest(
  blog: Blog,
  posts: Post[],
  folder?: Folder,
  /**
   * Resolved by the caller with templatesForPosts. Passed in rather than
   * fetched here so this stays synchronous, and so documentHash agrees with
   * what GET files/{id} serves: both sides must inline the same definition or
   * every client re-downloads every file on every manifest.
   */
  templates: Map<string, TemplateDefinition> = new Map(),
  templateAuthoringSources: Map<string, AuthoringSource> = new Map(),
) {
  const manifest = renderFolderManifest(
    blog,
    posts,
    syncManifestOptions(blog, folder),
  );
  return {
    ...manifest,
    items: manifest.items.map((item, index): SyncManifestItem => {
      const post = posts[index];
      const document = renderSyncDocumentFile(
        blog,
        post,
        folder?.path ?? BLOG_FOLDER_PATH,
        templateForPost(post, templates),
        templateAuthoringSourceForPost(post, templateAuthoringSources),
      );
      return {
        ...item,
        file: syncFilePath(post),
        representation: syncFileRepresentation(post),
        spotlightEligible: spotlightEligible(post, folder),
        documentHash: document.hash,
        documentSize: new TextEncoder().encode(document.text).length,
      };
    }),
  };
}

/** One manifest v2 entry for a post, as PUT/POST return it. */
export function syncManifestItem(blog: Blog, post: Post): SyncManifestItem {
  return renderSyncFolderManifest(blog, [post]).items[0];
}

/** Mutation responses use the same full-document hash as file GET/manifest. */
export async function resolvedSyncManifestItem(blog: Blog, post: Post): Promise<SyncManifestItem> {
  try {
    const [templates, folder] = await Promise.all([
      templatesForPosts(blog.handle, [post]),
      post.folderId ? getFolderById(blog.handle, post.folderId) : Promise.resolve(null),
    ]);
    const sources = await templateAuthoringSourcesForPosts(blog.handle, templates);
    return renderSyncFolderManifest(blog, [post], folder ?? undefined, templates, sources).items[0];
  } catch {
    // The write has already committed. A follow-up metadata read must not turn
    // it into an ambiguous failure; the next folder poll serves the full hash.
    return syncManifestItem(blog, post);
  }
}

/** Private items never leave the app through Spotlight. Missing folder or
 * visibility metadata is private. Trashed items are excluded by the store. */
export function spotlightEligible(post: Post, folder?: Folder): boolean {
  const visibility = post.visibility;
  return folder?.mode === "blog" && (visibility === "public" || visibility === "link");
}
