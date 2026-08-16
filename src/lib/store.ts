// Content access for the app. This is the ONLY content access point: routes and
// the editor go through here. Postgres (Drizzle + Neon) is the sole backing
// store; the demo seed that once served every read path without a database was
// removed 2026-08-14, so a missing DATABASE_URL now fails loudly instead of
// quietly serving fixture content.

const NO_DATABASE = "TextText requires DATABASE_URL";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { cache } from "react";
import {
  BLOG_FOLDER_PATH,
  DEFAULT_FILE_REPRESENTATION,
  isPrivatePostType,
  isPublishedPublicPost,
  readingTimeMinForWordCount,
  wordCountForMarkdown,
} from "./content";
import type {
  Blog,
  BlogCardStyle,
  BlogHomeView,
  BookmarkCaptureAsset,
  BookmarkCapture,
  CaptureStatus,
  Folder,
  FolderMode,
  FileRepresentation,
  LinkRef,
  Post,
  PostType,
} from "./content";
import {
  auditCteFrom,
  recordAction,
  type AuditActorType,
  type AuditEntry,
} from "./audit";
import { getBlogCore, getBlogCoreByUsername } from "./blog-core";
import { db } from "./db/client";
import {
  actionAudit,
  apiTokens,
  appHealthReports,
  blogs,
  collabPresence,
  collabState,
  collabUpdates,
  collaborators,
  contentReports,
  deletedAccounts,
  deviceLinks,
  documentCapabilityLinks,
  documentResponses,
  documentTemplates,
  folders,
  idempotencyKeys,
  itemComments,
  posts,
  publicUrlTombstones,
  userIdentities,
  users,
  verificationTokens,
  workspaceAiConfigs,
} from "./db/schema";
import { listItemAssetReferences } from "./item-assets";
import { localizeRemoteMarkdownImages } from "./markdown-images";
import {
  accessibleFolderIdsForUser,
  accessiblePostIdsForUser,
  type AccessUser,
} from "./permissions";
import {
  RESERVED_USERNAMES,
  USERNAME_RE,
  cleanUsername,
  slugifyUsername,
} from "./public-paths";
import {
  classifySlugCandidates,
  isSafePostSlug,
  sanitizePostSlug,
} from "./post-slug";
import { RESERVED_HANDLES, TENANT_HANDLE_RE } from "./tenants";
import {
  captureGeneration,
  completeCaptureGeneration,
  completedCaptureGeneration,
  failCaptureGeneration,
  finalizeCaptureGeneration,
  publicBookmarkCapture,
  retainCaptureGeneration,
  stageCaptureGeneration,
  startCaptureGeneration,
  type BookmarkCaptureGeneration,
} from "./bookmark-capture-generation";
import {
  CHATGPT_CONNECTOR_URL,
  CLAUDE_PLUGIN_INSTALL_COMMAND,
  CODEX_PLUGIN_INSTALL_COMMAND,
  TEXTTEXT_HOSTED_MCP_URL,
} from "./agent-integrations";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { normalizeTag, normalizeTags } from "./tags";
import {
  documentFromLegacyPost,
  legacyProjectionFromDocument,
  legacyTemplateId,
} from "./documents/legacy";
import {
  emptyDocumentSnapshot,
  requireDocumentSnapshot,
  validateDocumentSnapshot,
  type DocumentSnapshot,
  type DocumentVisibility,
  type TemplateReference,
  documentFieldValueSchema,
  type DocumentFieldValue,
} from "./documents/model";
import { resolveDocumentVisibility } from "./documents/visibility";
import {
  getBuiltinTemplate,
  BUILTIN_TEMPLATES,
} from "./presentation/templates";
import {
  validateTemplateDefinition,
  type TemplateDefinition,
} from "./presentation/schema";

type PostRow = typeof posts.$inferSelect;
type ItemCommentRow = typeof itemComments.$inferSelect;
type PostFolderRow = Pick<PostRow, "id" | "folderId" | "type">;
type PostListRow = Pick<
  PostRow,
  | "id"
  | "blogId"
  | "folderId"
  | "representation"
  | "visibility"
  | "templateId"
  | "templateVersion"
  | "type"
  | "slug"
  | "title"
  | "excerpt"
  | "accent"
  | "cover"
  | "coverCaption"
  | "coverHeight"
  | "tags"
  | "videoUrl"
  | "venue"
  | "duration"
  | "captureStatus"
  | "status"
  | "pinned"
  | "starred"
  | "publishedAt"
  | "createdAt"
  | "updatedAt"
  | "wordCount"
> & {
  bodyPreview: string | null;
  capture: BookmarkCapture | null;
  captureUrl: string | null;
  captureTitle: string | null;
  captureDescription: string | null;
  captureScreenshotUrl: string | null;
  linkLabel: string | null;
  linkHref: string | null;
};
type BlogRow = {
  handle: string;
  username: string | null;
  name: string;
  tagline: string | null;
  accent: string | null;
  bioLine: string | null;
  cardStyle: string | null;
  homeLayout: string | null;
  author: string | null;
};
export type BlogPatch = {
  name?: string;
  handle?: string;
  accent?: string | null;
  tagline?: string | null;
  bioLine?: string | null;
  cardStyle?: BlogCardStyle;
  homeLayout?: BlogHomeView;
  username?: string;
};
export type AdjacentPostLink = Pick<Post, "id" | "folderId" | "slug" | "title">;
export type AdjacentPublishedPosts = {
  previous: AdjacentPostLink | null;
  next: AdjacentPostLink | null;
};
export type BlogEditRecord = {
  id: string;
  handle: string;
  name: string;
  ownerId: string | null;
};
export type StoreUser = {
  sub: string;
  name?: string;
  email?: string;
};

export type ItemCommentAnchorField = "title" | "excerpt" | "body";
export type ItemCommentAnchor = {
  field: ItemCommentAnchorField;
  exactQuote: string;
  start?: number;
  end?: number;
  /** Base64-encoded Y.RelativePosition values. Offsets remain quote fallbacks. */
  startRelative?: string;
  endRelative?: string;
};
export type ItemCommentActor = {
  actorUserId: string | null;
  actorType: AuditActorType;
};
export type ItemCommentActorContext = {
  actorUserId?: string | null;
  actorType: AuditActorType;
  actorName?: string | null;
};
export type ItemComment = {
  id: string;
  itemId: string;
  parentId: string | null;
  body: string;
  anchor: ItemCommentAnchor | null;
  author: ItemCommentActor;
  authorName: string | null;
  editedBy: ItemCommentActor | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: ItemCommentActor | null;
  createdAt: string;
  updatedAt: string;
};
export type ItemCommentListOptions = {
  /** Omit to include both open and resolved comments. */
  resolved?: boolean;
  /** Omit to include top-level comments and replies; null selects roots. */
  parentId?: string | null;
};
export type CreateItemCommentInput = {
  itemId: string;
  parentId?: string | null;
  body: string;
  anchor?: ItemCommentAnchor | null;
};
export type CreateItemCommentRequest = CreateItemCommentInput & {
  actor: ItemCommentActorContext;
};
export type UpdateItemCommentInput = {
  body?: string;
  /** null removes an existing anchor; omission preserves it. */
  anchor?: ItemCommentAnchor | null;
};
export type SetItemCommentResolvedInput = {
  itemId: string;
  commentId: string;
  resolved: boolean;
};
export type SetItemCommentResolvedRequest = SetItemCommentResolvedInput & {
  actor: ItemCommentActorContext;
};

export type DocumentCapabilityRole = "viewer" | "commenter" | "editor";
export type DocumentCapability = {
  id: string;
  itemId: string;
  role: DocumentCapabilityRole;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
export type ResolvedDocumentCapability = DocumentCapability & {
  handle: string;
};
export type CreatedDocumentCapability = DocumentCapability & {
  token: string;
};

const DEFAULT_CARD_STYLE: BlogCardStyle = "cover";
const DEFAULT_HOME_LAYOUT: BlogHomeView = "list";

function toISODate(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  const iso = typeof value === "string" ? value : value.toISOString();
  return iso.slice(0, 10);
}

function readingTimeForWordCount(wordCount: number | null): number | undefined {
  return wordCount == null ? undefined : readingTimeMinForWordCount(wordCount);
}

function mapPost(row: PostRow): Post {
  const wordCount = row.wordCount ?? wordCountForMarkdown(row.body);
  const legacyPost: Post = {
    id: row.id,
    representation: row.representation,
    visibility: row.visibility,
    template: { id: row.templateId, version: row.templateVersion },
    type: row.type,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? undefined,
    // A null accent means "inherit the blog accent"; an empty string is an
    // explicit opt-out. Preserve the distinction (see postAccent in content.ts).
    accent: row.accent ?? undefined,
    cover: row.cover ?? undefined,
    coverCaption: row.coverCaption ?? undefined,
    coverHeight: row.coverHeight ?? undefined,
    gallery: row.gallery ?? undefined,
    links: row.links ?? undefined,
    tags: normalizeTags(row.tags),
    videoUrl: row.videoUrl ?? undefined,
    venue: row.venue ?? undefined,
    duration: row.duration ?? undefined,
    body: row.body,
    wordCount,
    readingTime: readingTimeMinForWordCount(wordCount),
    captureStatus: cleanCaptureStatus(row.captureStatus),
    capture: publicBookmarkCapture(row.capture),
    date: toISODate(row.publishedAt ?? row.createdAt),
    status: row.status,
    pinned: row.pinned,
    starred: row.starred,
    folderId: row.folderId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revision: row.revision ?? undefined,
  };
  const document = requireDocumentSnapshot(
    row.document,
    `Persisted item ${row.id}`,
  );
  return {
    ...legacyPost,
    document,
    visibility: row.visibility,
    template: document.presentation.template,
  };
}

function compactCapture(row: PostListRow): BookmarkCapture | undefined {
  if (row.capture) return publicBookmarkCapture(row.capture);
  const capture: Partial<BookmarkCapture> = {
    url: row.captureUrl ?? undefined,
    title: row.captureTitle ?? undefined,
    description: row.captureDescription ?? undefined,
    screenshotUrl: row.captureScreenshotUrl ?? undefined,
  };
  return Object.values(capture).some(Boolean)
    ? (capture as BookmarkCapture)
    : undefined;
}

function compactLinks(row: PostListRow): LinkRef[] | undefined {
  if (!row.linkHref) return undefined;
  return [{ label: row.linkLabel ?? row.linkHref, href: row.linkHref }];
}

function mapPostList(row: PostListRow): Post {
  return {
    id: row.id,
    representation: row.representation,
    visibility: row.visibility,
    template: { id: row.templateId, version: row.templateVersion },
    type: row.type,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? undefined,
    accent: row.accent ?? undefined,
    cover: row.cover ?? undefined,
    coverCaption: row.coverCaption ?? undefined,
    coverHeight: row.coverHeight ?? undefined,
    tags: normalizeTags(row.tags),
    links: compactLinks(row),
    videoUrl: row.videoUrl ?? undefined,
    venue: row.venue ?? undefined,
    duration: row.duration ?? undefined,
    body: row.bodyPreview ?? "",
    bodyPreview: row.bodyPreview ?? undefined,
    wordCount: row.wordCount ?? undefined,
    readingTime: readingTimeForWordCount(row.wordCount),
    captureStatus: cleanCaptureStatus(row.captureStatus),
    capture: compactCapture(row),
    date: toISODate(row.publishedAt ?? row.createdAt),
    status: row.status,
    pinned: row.pinned,
    starred: row.starred,
    folderId: row.folderId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function withoutPersonalWorkspaceMetadata(post: Post): Post {
  if (post.starred === undefined) return post;
  const { starred: _starred, ...publicPost } = post;
  return publicPost;
}

const BODY_PREVIEW_LENGTH = 2048;

function bodyPreviewSql(): SQL<string | null> {
  return sql<string | null>`case
    when ${posts.type} = 'note' then nullif(${posts.body}, '')
    else nullif(left(${posts.body}, ${BODY_PREVIEW_LENGTH}), '')
  end`;
}

function wordCountSql(): SQL<number | null> {
  return sql<number | null>`coalesce(
    ${posts.wordCount},
    case
      when btrim(${posts.body}) = '' then 0
      else cardinality(regexp_split_to_array(btrim(${posts.body}), '[[:space:]]+'))
    end
  )`;
}

function postListSelection() {
  return {
    id: posts.id,
    blogId: posts.blogId,
    folderId: posts.folderId,
    representation: posts.representation,
    visibility: posts.visibility,
    templateId: posts.templateId,
    templateVersion: posts.templateVersion,
    type: posts.type,
    slug: posts.slug,
    title: posts.title,
    excerpt: posts.excerpt,
    accent: posts.accent,
    cover: posts.cover,
    coverCaption: posts.coverCaption,
    coverHeight: posts.coverHeight,
    tags: posts.tags,
    videoUrl: posts.videoUrl,
    venue: posts.venue,
    duration: posts.duration,
    captureStatus: posts.captureStatus,
    status: posts.status,
    pinned: posts.pinned,
    starred: posts.starred,
    publishedAt: posts.publishedAt,
    createdAt: posts.createdAt,
    updatedAt: posts.updatedAt,
    wordCount: wordCountSql(),
    bodyPreview: bodyPreviewSql(),
    capture: posts.capture,
    captureUrl: sql<string | null>`${posts.capture}->>'url'`,
    captureTitle: sql<string | null>`${posts.capture}->>'title'`,
    captureDescription: sql<string | null>`${posts.capture}->>'description'`,
    captureScreenshotUrl: sql<string | null>`${posts.capture}->>'screenshotUrl'`,
    linkLabel: sql<string | null>`${posts.links}->0->>'label'`,
    linkHref: sql<string | null>`${posts.links}->0->>'href'`,
  };
}

function cleanCaptureStatus(value: string | null): CaptureStatus | undefined {
  if (value === "pending" || value === "captured" || value === "failed") {
    return value;
  }
  return undefined;
}

function mapBlog(row: BlogRow): Blog {
  return {
    handle: row.handle,
    username: row.username ?? undefined,
    name: row.name,
    author: row.author?.trim() || row.name.trim() || "Anonymous",
    tagline: row.tagline ?? undefined,
    accent: row.accent ?? undefined,
    bioLine: row.bioLine ?? undefined,
    cardStyle: cleanStoredCardStyle(row.cardStyle),
    homeLayout: cleanStoredHomeLayout(row.homeLayout),
  };
}

async function getBlogUncached(handle: string): Promise<Blog | null> {
  if (!db) throw new Error(NO_DATABASE);
  const row = await getBlogCore(handle);
  if (!row) return null;
  return mapBlog(row);
}

const getBlogCached = cache(getBlogUncached);

export async function getBlog(handle: string): Promise<Blog | null> {
  return getBlogCached(handle);
}

async function getBlogByUsernameNormalized(
  username: string,
): Promise<Blog | null> {
  if (!db) throw new Error(NO_DATABASE);
  const row = await getBlogCoreByUsername(username);
  if (!row) return null;
  return mapBlog(row);
}

const getBlogByUsernameCached = cache(getBlogByUsernameNormalized);

export async function getBlogByUsername(
  usernameInput: string,
): Promise<Blog | null> {
  // Lookups normalize but never validate: reserved-ness only matters when a
  // username is SET, and the seeded demo username is reserved yet resolvable.
  const username = usernameInput.trim().toLowerCase();
  if (!username || !/^[a-z0-9-]{1,30}$/.test(username)) return null;
  return getBlogByUsernameCached(username);
}

async function selectPosts(handle: string, publishedOnly: boolean): Promise<Post[]> {
  const rows = await db!
    .select(postListSelection())
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      publishedOnly
        ? and(
            eq(blogs.handle, handle),
            eq(posts.visibility, "public"),
            eq(posts.status, "published"),
            ne(posts.type, "note"),
            ne(posts.type, "bookmark"),
            isNull(blogs.deletedAt),
            isNull(posts.deletedAt),
          )
        : and(
            eq(blogs.handle, handle),
            isNull(blogs.deletedAt),
            isNull(posts.deletedAt),
          ),
    )
    .orderBy(
      desc(posts.pinned),
      publishedOnly ? desc(posts.publishedAt) : desc(posts.updatedAt),
      desc(posts.createdAt),
    );
  const mapped = rows.map(mapPostList);
  return publishedOnly
    ? mapped.map(withoutPersonalWorkspaceMetadata)
    : mapped;
}

function pinnedFirst(items: Post[]): Post[] {
  return items
    .map((post, index) => ({ post, index }))
    .sort((a, b) => {
      if (Boolean(a.post.pinned) !== Boolean(b.post.pinned)) {
        return Number(Boolean(b.post.pinned)) - Number(Boolean(a.post.pinned));
      }
      return a.index - b.index;
    })
    .map(({ post }) => post);
}

async function getPostsUncached(handle: string): Promise<Post[]> {
  if (!db) throw new Error(NO_DATABASE);
  return selectPosts(handle, true);
}

const getPostsCached = cache(getPostsUncached);

export async function getPosts(handle: string): Promise<Post[]> {
  return getPostsCached(handle);
}

export type PublicPostLocation = {
  folderPath: string;
  post: Post;
};

async function getPublicPostLocationsUncached(
  handle: string,
): Promise<PublicPostLocation[]> {
  if (!db) throw new Error(NO_DATABASE);
  const rows = await db
    .select({ folderPath: folders.path, post: posts })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .innerJoin(folders, eq(posts.folderId, folders.id))
    .where(
      and(
        eq(blogs.handle, handle),
        eq(posts.visibility, "public"),
        eq(posts.status, "published"),
        ne(posts.type, "note"),
        ne(posts.type, "bookmark"),
        isNull(blogs.deletedAt),
        isNull(posts.deletedAt),
        isNull(folders.deletedAt),
      ),
    )
    .orderBy(
      desc(posts.pinned),
      desc(posts.publishedAt),
      desc(posts.createdAt),
    );
  return rows.map((row) => ({
    folderPath: row.folderPath,
    post: withoutPersonalWorkspaceMetadata(mapPost(row.post)),
  }));
}

const getPublicPostLocationsCached = cache(getPublicPostLocationsUncached);

/** The one leak-safe source for public pages and every public side channel. */
export async function getPublicPostLocations(
  handle: string,
): Promise<PublicPostLocation[]> {
  return getPublicPostLocationsCached(handle);
}

async function getPostsForTagUncached(
  handle: string,
  tagInput: string,
  publishedOnly: boolean,
): Promise<Post[]> {
  const tag = normalizeTag(tagInput);
  if (!tag) return [];
  if (!db) throw new Error(NO_DATABASE);

  const rows = await db
    .select(postListSelection())
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      and(
        eq(blogs.handle, handle),
        isNull(blogs.deletedAt),
        isNull(posts.deletedAt),
        ne(posts.type, "note"),
        ne(posts.type, "bookmark"),
        publishedOnly ? eq(posts.visibility, "public") : undefined,
        publishedOnly ? eq(posts.status, "published") : undefined,
        sql`${posts.tags} @> ARRAY[${tag}]::text[]`,
      ),
    )
    .orderBy(
      desc(posts.pinned),
      publishedOnly ? desc(posts.publishedAt) : desc(posts.updatedAt),
      desc(posts.createdAt),
    );
  return rows.map(mapPostList).map(withoutPersonalWorkspaceMetadata);
}

const getPostsForTagCached = cache(getPostsForTagUncached);

/** Public-kind posts carrying one canonical tag. Private item types never pass. */
export async function getPostsForTag(
  handle: string,
  tag: string,
  options: { publishedOnly?: boolean } = {},
): Promise<Post[]> {
  return getPostsForTagCached(handle, tag, options.publishedOnly ?? true);
}

async function getAllPostsUncached(handle: string): Promise<Post[]> {
  if (!db) throw new Error(NO_DATABASE);
  return selectPosts(handle, false);
}

const getAllPostsCached = cache(getAllPostsUncached);

export async function getAllPosts(handle: string): Promise<Post[]> {
  return getAllPostsCached(handle);
}

export async function countAllPosts(handle: string): Promise<number> {
  if (!db) throw new Error(NO_DATABASE);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      and(
        eq(blogs.handle, handle),
        isNull(blogs.deletedAt),
        isNull(posts.deletedAt),
      ),
    );
  return Number(rows[0]?.count ?? 0);
}

export async function getAdjacentPublishedPosts(
  handle: string,
  postKey: string,
): Promise<AdjacentPublishedPosts> {
  const published = await getPosts(handle);
  const index = published.findIndex(
    (post) => post.id === postKey || post.slug === postKey,
  );
  if (index < 0) return { previous: null, next: null };

  const previous = published[index - 1];
  const next = published[index + 1];
  return {
    previous: previous
      ? {
          id: previous.id,
          folderId: previous.folderId,
          slug: previous.slug,
          title: previous.title,
        }
      : null,
    next: next
      ? { id: next.id, folderId: next.folderId, slug: next.slug, title: next.title }
      : null,
  };
}

async function getPostUncached(
  handle: string,
  slug: string,
): Promise<Post | null> {
  if (!db) throw new Error(NO_DATABASE);
  const rows = await db
    .select()
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      and(
        eq(blogs.handle, handle),
        eq(posts.slug, slug),
        isNull(blogs.deletedAt),
        isNull(posts.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ? mapPost(rows[0].posts) : null;
}

const getPostCached = cache(getPostUncached);

export async function getPost(
  handle: string,
  slug: string,
): Promise<Post | null> {
  if (!isSafePostSlug(slug)) return null;
  return getPostCached(handle, slug);
}

/** One live item at its folder-qualified workspace location, regardless of visibility. */
export async function getPostByFolderPath(
  handle: string,
  folderPath: string,
  slug: string,
): Promise<Post | null> {
  if (!isSafePostSlug(slug)) return null;
  if (!db) throw new Error(NO_DATABASE);
  const [row] = await db
    .select({ post: posts })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .innerJoin(folders, eq(posts.folderId, folders.id))
    .where(
      and(
        eq(blogs.handle, handle),
        eq(folders.path, folderPath),
        eq(posts.slug, slug),
        isNull(blogs.deletedAt),
        isNull(folders.deletedAt),
        isNull(posts.deletedAt),
      ),
    )
    .limit(1);
  return row ? mapPost(row.post) : null;
}

export type PostSlugResolution =
  | { kind: "exact"; post: Post }
  | { kind: "history"; post: Post }
  | { kind: "tombstone" | "ambiguous" | "missing" };

export type PublicPostPathResolution =
  | { kind: "exact"; folderPath: string; post: Post }
  | { kind: "redirect"; folderPath: string; post: Post }
  | { kind: "missing" };

function publicPathFor(folderPath: string, slug: string): string {
  return `${folderPath}/${slug}`;
}

async function publicPostLocationById(
  blogId: string,
  postId: string,
): Promise<{ folderPath: string; post: Post } | null> {
  const [row] = await db!
    .select({ folderPath: folders.path, post: posts })
    .from(posts)
    .innerJoin(folders, eq(posts.folderId, folders.id))
    .where(
      and(
        eq(posts.blogId, blogId),
        eq(posts.id, postId),
        isNull(posts.deletedAt),
        isNull(folders.deletedAt),
      ),
    )
    .limit(1);
  if (!row || !isPublishedPublicPost(mapPost(row.post))) return null;
  return { folderPath: row.folderPath, post: withoutPersonalWorkspaceMetadata(mapPost(row.post)) };
}

/**
 * Resolve one folder-qualified public path. Private, draft, deleted, unknown,
 * and dead-tombstone paths deliberately collapse to the same `missing` result.
 */
export async function resolvePublicPostPath(
  handle: string,
  folderPath: string,
  slug: string,
): Promise<PublicPostPathResolution> {
  if (!isSafePostSlug(slug)) return { kind: "missing" };
  if (!db) throw new Error(NO_DATABASE);

  const blog = await getBlogCore(handle);
  if (!blog) return { kind: "missing" };
  const path = publicPathFor(folderPath, slug);
  const [exact, tombstone] = await Promise.all([
    db
      .select({ folderPath: folders.path, post: posts })
      .from(posts)
      .innerJoin(folders, eq(posts.folderId, folders.id))
      .where(
        and(
          eq(posts.blogId, blog.id),
          eq(folders.path, folderPath),
          eq(posts.slug, slug),
          isNull(posts.deletedAt),
          isNull(folders.deletedAt),
        ),
      )
      .limit(1),
    db
      .select({ postId: publicUrlTombstones.postId })
      .from(publicUrlTombstones)
      .where(
        and(
          eq(publicUrlTombstones.blogId, blog.id),
          eq(publicUrlTombstones.path, path),
        ),
      )
      .limit(1),
  ]);

  const exactRow = exact[0];
  const reservedFor = tombstone[0]?.postId;
  if (exactRow) {
    const post = mapPost(exactRow.post);
    if (
      !isPublishedPublicPost(post) ||
      (tombstone.length > 0 && reservedFor !== post.id)
    ) {
      return { kind: "missing" };
    }
    return {
      kind: "exact",
      folderPath: exactRow.folderPath,
      post: withoutPersonalWorkspaceMetadata(post),
    };
  }

  if (!reservedFor) return { kind: "missing" };
  const target = await publicPostLocationById(blog.id, reservedFor);
  return target ? { kind: "redirect", ...target } : { kind: "missing" };
}

/** A pre-migration flat URL resolves only through its frozen original owner. */
export async function resolveLegacyPublicSlug(
  handle: string,
  slug: string,
): Promise<PublicPostPathResolution> {
  if (!isSafePostSlug(slug)) return { kind: "missing" };
  if (!db) throw new Error(NO_DATABASE);
  const blog = await getBlogCore(handle);
  if (!blog) return { kind: "missing" };
  const [legacy] = await db
    .select({ postId: publicUrlTombstones.postId })
    .from(publicUrlTombstones)
    .where(
      and(
        eq(publicUrlTombstones.blogId, blog.id),
        eq(publicUrlTombstones.path, `@legacy/${slug}`),
      ),
    )
    .limit(1);
  if (!legacy?.postId) return { kind: "missing" };
  const target = await publicPostLocationById(blog.id, legacy.postId);
  return target ? { kind: "redirect", ...target } : { kind: "missing" };
}

/**
 * Resolve a current slug or historical alias from one tenant-scoped database
 * snapshot. Exact current rows win; deleted exact rows reserve the URL; an
 * ambiguous historical alias fails closed.
 */
export async function resolvePostSlug(
  handle: string,
  slug: string,
): Promise<PostSlugResolution> {
  if (!isSafePostSlug(slug)) return { kind: "missing" };
  if (!db) throw new Error(NO_DATABASE);

  const rows = await db
    .select({ post: posts })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      and(
        eq(blogs.handle, handle),
        isNull(blogs.deletedAt),
        or(
          eq(posts.slug, slug),
          sql`${posts.slugHistory} @> ARRAY[${slug}]::text[]`,
        ),
      ),
    );
  const resolution = classifySlugCandidates(
    slug,
    rows.map(({ post }) => post),
  );
  if (resolution.kind === "exact" || resolution.kind === "history") {
    return { kind: resolution.kind, post: mapPost(resolution.row) };
  }
  return { kind: resolution.kind };
}

/** Current slugs plus only those historical aliases that resolve uniquely. */
export async function getPostSlugAliases(
  handle: string,
): Promise<Record<string, string>> {
  if (!db) throw new Error(NO_DATABASE);
  const rows = await db
    .select({ slug: posts.slug, slugHistory: posts.slugHistory })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      and(
        eq(blogs.handle, handle),
        isNull(blogs.deletedAt),
        isNull(posts.deletedAt),
      ),
    );
  const current = new Set(rows.map((row) => row.slug));
  const owners = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const alias of row.slugHistory) {
      const aliases = owners.get(alias) ?? new Set<string>();
      aliases.add(row.slug);
      owners.set(alias, aliases);
    }
  }
  const aliases: Record<string, string> = Object.fromEntries(
    rows.map((row) => [row.slug, row.slug]),
  );
  for (const [alias, candidates] of owners) {
    if (current.has(alias) || candidates.size !== 1) continue;
    aliases[alias] = [...candidates][0]!;
  }
  return aliases;
}

async function blogIdFor(handle: string): Promise<string> {
  const id = (await getBlogCore(handle))?.id;
  if (!id) throw new Error(`unknown blog "${handle}"`);
  return id;
}

// Every workspace has these three system folders. Provisioning creates them,
// and the migration backfills older workspaces so reads never write.
const WORKSPACE_FOLDERS: ReadonlyArray<Omit<Folder, "id">> = [
  {
    name: "Blog",
    path: "blog",
    mode: "blog",
    defaultTemplate: { id: "texttext.article", version: 1 },
    position: 0,
  },
  {
    name: "Notes",
    path: "notes",
    mode: "notes",
    defaultTemplate: { id: "texttext.note", version: 1 },
    position: 1,
  },
  {
    name: "Bookmarks",
    path: "bookmarks",
    mode: "bookmarks",
    defaultTemplate: { id: "texttext.bookmark", version: 1 },
    position: 2,
  },
];

const DEFAULT_FOLDER_PATH = BLOG_FOLDER_PATH;

const STARTER_AGENT_GUIDES = [
  {
    slug: "connect-your-ai-tools",
    title: "Connect your AI tools",
    body: `TextText works beside the AI tools you already use. Each connected agent appears in live documents with its own name and avatar.

## Claude

Install the TextText plugin from Terminal:

\`\`\`text
${CLAUDE_PLUGIN_INSTALL_COMMAND}
\`\`\`

For Claude.ai, open **Settings > Connectors**, add ${TEXTTEXT_HOSTED_MCP_URL}, and approve the connection in TextText.

## Codex

Install the TextText plugin from Terminal:

\`\`\`text
${CODEX_PLUGIN_INSTALL_COMMAND}
\`\`\`

Codex appears as **Codex** while it works in an open document.

## ChatGPT

Open ${CHATGPT_CONNECTOR_URL}, add a custom app using ${TEXTTEXT_HOSTED_MCP_URL}, and approve access in TextText.

ChatGPT appears as **ChatGPT** while it works in an open document.

## Other MCP clients

Add ${TEXTTEXT_HOSTED_MCP_URL} to any client that supports remote MCP with OAuth. Give the connection a descriptive name. TextText uses that approved name when the client is not Claude, Codex, ChatGPT, or Cursor.

## Check it worked

Ask your agent: "List my TextText library." If it answers with your items, the connection is live. From then on the agent appears with its own name and avatar whenever it works in a document you have open.

## What agents can do

Connected agents can create and find documents, update or append content, move items, publish articles, manage access, add comments, recapture bookmarks, and work in the same live document as you. Privacy and audit rules apply no matter which client performs the action.`,
  },
  {
    slug: "use-texttext-as-a-live-ai-canvas",
    title: "Use TextText as a live AI canvas",
    body: `Keep a TextText document open beside Claude, Codex, ChatGPT, or another connected agent. The document stays the main surface. The agent assists inside it.

## Start with one document

Tell the agent:

> Use TextText as the live canvas for this task. Find the matching document or create it once, tell me which document to open, and keep that same item current as our work develops. Preserve my concurrent edits, reconcile conflicts, and use stable idempotency keys for every append that may retry.

Open the item in TextText. When the agent writes, its provider name and avatar appear with the other collaborators. You can keep typing while it works.

## Capture useful AI conversations

Tell the agent:

> Save the useful decisions from this conversation as a TextText note. Include the source context and verify the saved note.

## Maintain a project changelog

Tell the agent:

> Find the changelog for this project and append today's shipped user-facing changes exactly once. Create it only if it does not exist, keep using the same item, and derive a stable idempotency key from the source commit or release.

## Work safely

Ask the agent to find an existing item before creating one. For repeated automation, require a stable idempotency key. Keep the target document open when you want to watch and edit alongside the agent. Use sharing controls to decide who can view, comment, or edit.`,
  },
] as const;

// Workspaces provisioned before 2026-08-08 were handed a set of explanatory
// documents. They still exist, and they still must not count against the
// try-before-signup item cap. New workspaces are provisioned empty.
const WORKSPACE_STARTER_POST_SLUGS = [
  "welcome-to-your-blog",
  "scratch-note",
  "texttext-ai-setup-guide",
  ...STARTER_AGENT_GUIDES.map((guide) => guide.slug),
] as const;

export function isWorkspaceStarterPost(post: Pick<Post, "slug">): boolean {
  return (WORKSPACE_STARTER_POST_SLUGS as readonly string[]).includes(post.slug);
}

function starterAgentGuideValues(blogId: string, folderId: string) {
  return STARTER_AGENT_GUIDES.map((guide) => {
    const document = validateDocumentSnapshot({
      ...emptyDocumentSnapshot({ id: "texttext.note", version: 1 }),
      content: {
        ...emptyDocumentSnapshot({ id: "texttext.note", version: 1 }).content,
        title: guide.title,
        body: guide.body,
      },
    });
    return {
      blogId,
      folderId,
      representation: DEFAULT_FILE_REPRESENTATION,
      document,
      visibility: "private" as const,
      templateId: "texttext.note",
      templateVersion: 1,
      type: "note" as const,
      slug: guide.slug,
      title: guide.title,
      body: guide.body,
      wordCount: wordCountForMarkdown(guide.body),
      status: "draft" as const,
    };
  });
}

/** The system folder path a post of this type lives in. */
export function folderPathForPostType(type: PostType): string {
  if (type === "note") return "notes";
  if (type === "bookmark") return "bookmarks";
  return DEFAULT_FOLDER_PATH;
}

function mapFolder(
  row: Pick<
    typeof folders.$inferSelect,
    | "id"
    | "name"
    | "path"
    | "mode"
    | "position"
    | "parentId"
    | "defaultTemplateId"
    | "defaultTemplateVersion"
  >,
): Folder {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    mode: cleanFolderMode(row.mode),
    defaultTemplate: {
      id: row.defaultTemplateId,
      version: row.defaultTemplateVersion,
    },
    position: row.position,
    parentId: row.parentId ?? null,
  };
}

/** Subfolder nesting cap, counted in path segments ("blog/a/b" = 3). */
const MAX_FOLDER_DEPTH = 4;

function folderPathSegment(name: string): string {
  const segment = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return segment || "folder";
}

/**
 * Create a subfolder under an existing folder (system root or another
 * subfolder). The default presentation is inherited from the parent. Folder
 * mode remains a compatibility projection for older clients.
 */
export async function createSubfolder(
  handle: string,
  parentPath: string,
  name: string,
): Promise<Folder> {
  if (!db) throw new Error("Subfolders need a database.");
  const blogId = await blogIdFor(handle);
  const parentRows = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.blogId, blogId),
        eq(folders.path, parentPath),
        isNull(folders.deletedAt),
      ),
    )
    .limit(1);
  const parent = parentRows[0];
  if (!parent) throw new Error(`unknown folder "${parentPath}"`);
  if (parent.path.split("/").length >= MAX_FOLDER_DEPTH) {
    throw new Error("Folders can only nest four levels deep.");
  }
  const cleanName = name.trim().slice(0, 80);
  if (!cleanName) throw new Error("A folder needs a name.");
  const base = folderPathSegment(cleanName);
  // Try base, then -2 .. -9: insert with onConflictDoNothing settles races
  // on the (blog, path) partial unique index without a transaction.
  for (let attempt = 0; attempt < 9; attempt++) {
    const segment = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const path = `${parent.path}/${segment}`;
    const inserted = await db
      .insert(folders)
      .values({
        blogId,
        name: cleanName,
        path,
        mode: parent.mode,
        parentId: parent.id,
        position: parent.position,
        defaultTemplateId: parent.defaultTemplateId,
        defaultTemplateVersion: parent.defaultTemplateVersion,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return mapFolder(inserted[0]);
  }
  throw new Error("A folder with that name already exists here.");
}

export async function renameFolder(
  handle: string,
  folderId: string,
  name: string,
): Promise<Folder> {
  if (!db) throw new Error("Renaming folders needs a database.");
  const blogId = await blogIdFor(handle);
  const cleanName = name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!cleanName) throw new Error("A folder needs a name.");
  const updated = await db
    .update(folders)
    .set({ name: cleanName, updatedAt: new Date() })
    .where(
      and(
        eq(folders.id, folderId),
        eq(folders.blogId, blogId),
        isNull(folders.deletedAt),
      ),
    )
    .returning();
  if (!updated[0]) throw new Error("Folder not found");
  return mapFolder(updated[0]);
}

/**
 * Give a folder a look. The reference is what new items in the folder are
 * created with, and what the folder page renders its index from, so this one
 * write is what turns "make me a Medium blog" into a working folder.
 *
 * The template must already exist and resolve for this workspace, built-in or
 * workspace-authored. Pointing a folder at a template that cannot resolve
 * would leave every new item in it unrenderable, so it is refused here rather
 * than discovered later.
 */
export async function setFolderTemplate(
  handle: string,
  folderId: string,
  reference: TemplateReference,
): Promise<Folder> {
  if (!db) throw new Error("Setting a folder's look needs a database.");
  const blogId = await blogIdFor(handle);
  const template = await getDocumentTemplate(blogId, reference);
  if (!template) {
    throw new Error(
      `Unknown template ${reference.id}@${reference.version}`,
    );
  }
  const updated = await db
    .update(folders)
    .set({
      defaultTemplateId: reference.id,
      defaultTemplateVersion: reference.version,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(folders.id, folderId),
        eq(folders.blogId, blogId),
        isNull(folders.deletedAt),
      ),
    )
    .returning();
  if (!updated[0]) throw new Error("Folder not found");
  return mapFolder(updated[0]);
}

/**
 * Give every item already in a folder the folder's look.
 *
 * "Make my blog look like Medium" means the blog, not the posts written after
 * today. Setting only the folder's default left every existing post rendering
 * exactly as before, which reads as the request having done nothing: the index
 * changed and not one article did.
 *
 * Content is untouched. Only `presentation.template` moves.
 */
export async function retemplateFolderItems(
  handle: string,
  folderId: string,
  reference: TemplateReference,
  options: { limit?: number } = {},
): Promise<{ changed: number; remaining: number }> {
  if (!db) throw new Error("Retemplating needs a database.");
  const blogId = await blogIdFor(handle);
  const limit = options.limit ?? 500;
  const rows = await db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.blogId, blogId),
        eq(posts.folderId, folderId),
        isNull(posts.deletedAt),
      ),
    )
    .orderBy(asc(posts.createdAt));

  let changed = 0;
  for (const row of rows.slice(0, limit)) {
    const post = mapPost(row);
    const current = post.document;
    if (!current) continue;
    if (
      current.presentation.template.id === reference.id &&
      current.presentation.template.version === reference.version
    ) {
      continue;
    }
    await savePost(handle, {
      ...post,
      document: {
        ...current,
        presentation: { ...current.presentation, template: reference },
      },
      template: reference,
    });
    changed += 1;
  }
  return { changed, remaining: Math.max(0, rows.length - limit) };
}

/**
 * Bookmarks waiting for a capture agent (normally the Mac app). Each entry
 * carries the URL to capture: the first link's href, set at creation.
 */
export async function listPendingCaptures(
  handle: string,
): Promise<
  Array<{ id: string; slug: string; title: string; url: string; generation?: string }>
> {
  if (!db) return [];
  const blogId = await blogIdFor(handle);
  const rows = await db
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      linkHref: sql<string | null>`${posts.links}->0->>'href'`,
      captureUrl: sql<string | null>`${posts.capture}->>'url'`,
      capture: posts.capture,
    })
    .from(posts)
    .where(
      and(
        eq(posts.blogId, blogId),
        eq(posts.captureStatus, "pending"),
        isNull(posts.deletedAt),
      ),
    )
    .orderBy(asc(posts.createdAt))
    .limit(20);
  return rows
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      url: row.linkHref ?? row.captureUrl ?? "",
      generation: captureGeneration(row.capture)?.id,
    }))
    .filter((entry) => entry.url);
}

/**
 * Record a capture result. Owned by the capture pipeline, NEVER by the
 * markdown round-trip: a synced file can not wipe or forge capture state.
 * The readable extraction lands in the body only when the body is empty, so
 * a bookmark the owner annotated keeps their words.
 */
export async function saveBookmarkCapture(
  handle: string,
  postId: string,
  capture: BookmarkCapture,
  opts: {
    readableMarkdown?: string;
    failed?: boolean;
    /**
     * The server's cheap title/description fetch sets this: it fills capture
     * metadata but leaves the status pending so the full capture agent (the
     * Mac app, with screenshots and readable assets) still claims the bookmark.
     */
    keepPending?: boolean;
    /** A finalized capture generation replaces, rather than merges, artifacts. */
    replaceCapture?: boolean;
    /** Compare-and-swap guard used when finalizing a staged generation. */
    expectedRevision?: number;
    /** Hidden tombstone that rejects late uploads from a completed generation. */
    completedGeneration?: string;
  } = {},
): Promise<Post | null> {
  if (!db) return null;
  const blogId = await blogIdFor(handle);
  const existing = await db
    .select()
    .from(posts)
    .where(
      and(eq(posts.id, postId), eq(posts.blogId, blogId), isNull(posts.deletedAt)),
    )
    .limit(1);
  const row = existing[0];
  if (!row || row.type !== "bookmark") return null;
  const previousCapture = publicBookmarkCapture(row.capture);
  const merged: BookmarkCapture = opts.replaceCapture
    ? stripLegacyBookmarkHtmlUrl(capture)
    : mergeBookmarkCapture(previousCapture, capture);
  const readable = opts.readableMarkdown
    ? bookmarkReadableMarkdown(opts.readableMarkdown, merged.assets)
    : "";
  const body = (
    opts.replaceCapture
      ? shouldReplaceBookmarkReadableAfterRecapture(
          row.body,
          readable,
          previousCapture,
          merged.assets,
        )
      : shouldRefreshBookmarkReadable(row.body, readable, merged.assets)
  )
    ? readable
    : row.body;
  const clean = (value: string | undefined) =>
    (value ?? "").replace(/\s+/g, " ").trim();
  // The bookmark's host derived from its URL: both the placeholder title and the
  // auto-excerpt fall back to it.
  let urlHost = "";
  const sourceUrl = clean(merged.url) || clean(row.links?.[0]?.href);
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        urlHost = url.hostname.replace(/^www\./, "");
      }
    } catch {
      urlHost = "";
    }
  }

  let excerpt = row.excerpt;
  if (!row.excerpt?.trim()) {
    const truncate = (value: string) => {
      if (value.length <= 200) return value;
      const sliced = value.slice(0, 197).trimEnd();
      const wordBreak = sliced.lastIndexOf(" ");
      return `${wordBreak > 120 ? sliced.slice(0, wordBreak) : sliced}...`;
    };
    const autoExcerpt = truncate(
      clean(merged.description) || clean(merged.siteName) || urlHost,
    );
    if (autoExcerpt) excerpt = autoExcerpt;
  }

  // Promote the fetched article title once, so the bookmark reads by its real
  // title (and its file is named for it) instead of the bare host. Only while
  // the title is still the auto-generated host placeholder: never overwrite a
  // title the owner set (e.g. by renaming the file).
  let title = row.title;
  const capturedTitle = clean(merged.title);
  const isHostPlaceholder =
    !clean(row.title) ||
    clean(row.title) === urlHost ||
    clean(row.title) === `www.${urlHost}`;
  if (capturedTitle && isHostPlaceholder) title = capturedTitle;

  // The snapshot is the content model and title/body are projections of it, so
  // the two have to move together. This path used to write the columns alone,
  // which left a captured bookmark claiming a title of "gamedeveloper.com" in
  // its document while the column held the real headline. Nothing reads the
  // drift day to day, which is exactly why it survived: the canonical audit in
  // the release gate is what finds it.
  const canonical = requireDocumentSnapshot(
    row.document,
    `Persisted item ${row.id}`,
  );
  const document =
    canonical.content.title === title && canonical.content.body === body
      ? canonical
      : {
          ...canonical,
          content: { ...canonical.content, title, body },
        };

  const updated = await db
    .update(posts)
    .set({
      capture: opts.completedGeneration
        ? completeCaptureGeneration(merged, opts.completedGeneration)
        : opts.replaceCapture
          ? merged
          : retainCaptureGeneration(merged, row.capture),
      document,
      title,
      captureStatus: opts.keepPending
        ? "pending"
        : opts.failed
          ? "failed"
          : "captured",
      excerpt,
      body,
      wordCount: wordCountForMarkdown(body),
      updatedAt: new Date(),
    })
    .where(
      opts.expectedRevision === undefined
        ? eq(posts.id, row.id)
        : and(
            eq(posts.id, row.id),
            eq(posts.revision, opts.expectedRevision),
          ),
    )
    .returning();
  return updated[0] ? mapPost(updated[0]) : null;
}

export type BookmarkCaptureGenerationPreparation =
  | { ok: true; generation: BookmarkCaptureGeneration }
  | { ok: false; reason: "missing" | "stale" | "conflict"; message: string };

export type BookmarkCaptureGenerationSaveResult =
  | { ok: true; post: Post; finalized: boolean }
  | {
      ok: false;
      reason: "missing" | "stale" | "invalid" | "incomplete" | "conflict";
      message: string;
    };

const CAPTURE_GENERATION_CAS_ATTEMPTS = 5;

export async function prepareBookmarkCaptureGeneration(
  handle: string,
  postId: string,
  params: { requestedGeneration?: string; url: string },
): Promise<BookmarkCaptureGenerationPreparation> {
  if (!db) {
    return { ok: false, reason: "missing", message: "Bookmark not found" };
  }
  const blogId = await blogIdFor(handle);
  for (let attempt = 0; attempt < CAPTURE_GENERATION_CAS_ATTEMPTS; attempt += 1) {
    const rows = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.id, postId),
          eq(posts.blogId, blogId),
          eq(posts.type, "bookmark"),
          isNull(posts.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return { ok: false, reason: "missing", message: "Bookmark not found" };
    }
    const current = captureGeneration(row.capture);
    if (
      params.requestedGeneration &&
      params.requestedGeneration === completedCaptureGeneration(row.capture)
    ) {
      return {
        ok: false,
        reason: "stale",
        message: `Capture generation ${params.requestedGeneration} has already completed`,
      };
    }
    if (current) {
      if (
        params.requestedGeneration &&
        params.requestedGeneration !== current.id
      ) {
        return {
          ok: false,
          reason: "stale",
          message: `Capture generation ${params.requestedGeneration} is no longer current`,
        };
      }
      return { ok: true, generation: current };
    }

    const generationId = params.requestedGeneration || randomUUID();
    const storage = startCaptureGeneration(row.capture, {
      id: generationId,
      url: params.url,
      startedAt: new Date().toISOString(),
    });
    const updated = await db
      .update(posts)
      .set({ capture: storage, captureStatus: "pending", updatedAt: new Date() })
      .where(
        and(
          eq(posts.id, row.id),
          eq(posts.blogId, blogId),
          eq(posts.revision, row.revision),
          isNull(posts.deletedAt),
        ),
      )
      .returning({ capture: posts.capture });
    const generation = captureGeneration(updated[0]?.capture);
    if (generation) return { ok: true, generation };
  }
  return {
    ok: false,
    reason: "conflict",
    message: "Capture changed while preparing its generation",
  };
}

export async function saveBookmarkCaptureGeneration(
  handle: string,
  postId: string,
  generationId: string,
  incoming: BookmarkCapture,
  opts: {
    readableMarkdown?: string;
    screenshotCount?: number;
    isFinal?: boolean;
    failed?: boolean;
  } = {},
): Promise<BookmarkCaptureGenerationSaveResult> {
  if (!db) {
    return { ok: false, reason: "missing", message: "Bookmark not found" };
  }
  const blogId = await blogIdFor(handle);
  for (let attempt = 0; attempt < CAPTURE_GENERATION_CAS_ATTEMPTS; attempt += 1) {
    const rows = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.id, postId),
          eq(posts.blogId, blogId),
          eq(posts.type, "bookmark"),
          isNull(posts.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return { ok: false, reason: "missing", message: "Bookmark not found" };
    }

    if (opts.failed) {
      const failed = failCaptureGeneration(row.capture, generationId, incoming);
      if (!failed.ok) return failed;
      const saved = await saveBookmarkCapture(handle, postId, failed.capture, {
        failed: true,
        replaceCapture: true,
        expectedRevision: row.revision,
        completedGeneration: generationId,
      });
      if (saved) return { ok: true, post: saved, finalized: true };
      continue;
    }

    const staged = stageCaptureGeneration(row.capture, generationId, incoming, {
      startedAt: new Date().toISOString(),
      readableMarkdown: opts.readableMarkdown,
      screenshotCount: opts.screenshotCount,
    });
    if (!staged.ok) return staged;

    if (opts.isFinal) {
      const finalized = finalizeCaptureGeneration(staged.storage, generationId);
      if (!finalized.ok) return finalized;
      const saved = await saveBookmarkCapture(handle, postId, finalized.capture, {
        readableMarkdown: finalized.readableMarkdown,
        replaceCapture: true,
        expectedRevision: row.revision,
        completedGeneration: generationId,
      });
      if (saved) return { ok: true, post: saved, finalized: true };
      continue;
    }

    const updated = await db
      .update(posts)
      .set({
        capture: staged.storage,
        captureStatus: "pending",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(posts.id, row.id),
          eq(posts.blogId, blogId),
          eq(posts.revision, row.revision),
          isNull(posts.deletedAt),
        ),
      )
      .returning();
    if (updated[0]) {
      return { ok: true, post: mapPost(updated[0]), finalized: false };
    }
  }
  return {
    ok: false,
    reason: "conflict",
    message: "Capture changed while saving its generation",
  };
}

type LegacyBookmarkCapture = BookmarkCapture & { htmlUrl?: unknown };

export function legacyBookmarkHtmlUrl(
  capture: BookmarkCapture | null | undefined,
): string | undefined {
  const value = (capture as LegacyBookmarkCapture | null | undefined)?.htmlUrl;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function stripLegacyBookmarkHtmlUrl(
  capture: BookmarkCapture,
): BookmarkCapture {
  const sanitized: LegacyBookmarkCapture = { ...capture };
  delete sanitized.htmlUrl;
  return sanitized;
}

export function mergeBookmarkCapture(
  existing: BookmarkCapture | null | undefined,
  incoming: BookmarkCapture,
): BookmarkCapture {
  const merged = stripLegacyBookmarkHtmlUrl({
    ...(existing ?? {}),
    ...incoming,
  });
  const assets = mergeBookmarkCaptureAssets(existing?.assets, incoming.assets);
  if (assets.length > 0) merged.assets = assets;
  const screenshotTiles = mergeBookmarkCaptureScreenshotTiles(
    existing?.screenshotTiles,
    incoming.screenshotTiles,
  );
  if (screenshotTiles.length > 0) {
    merged.screenshotTiles = screenshotTiles;
    merged.screenshotUrl = screenshotTiles[0]?.url ?? merged.screenshotUrl;
  }
  return merged;
}

function mergeBookmarkCaptureScreenshotTiles(
  existing: BookmarkCapture["screenshotTiles"],
  incoming: BookmarkCapture["screenshotTiles"],
): NonNullable<BookmarkCapture["screenshotTiles"]> {
  const byIndex = new Map<
    number,
    NonNullable<BookmarkCapture["screenshotTiles"]>[number]
  >();
  for (const tile of existing ?? []) {
    if (Number.isInteger(tile.index) && tile.index >= 0 && tile.url) {
      byIndex.set(tile.index, tile);
    }
  }
  for (const tile of incoming ?? []) {
    if (Number.isInteger(tile.index) && tile.index >= 0 && tile.url) {
      byIndex.set(tile.index, tile);
    }
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

function mergeBookmarkCaptureAssets(
  existing: BookmarkCaptureAsset[] | undefined,
  incoming: BookmarkCaptureAsset[] | undefined,
): BookmarkCaptureAsset[] {
  const byOriginalUrl = new Map<string, BookmarkCaptureAsset>();
  for (const asset of existing ?? []) {
    if (asset.originalUrl && asset.url) byOriginalUrl.set(asset.originalUrl, asset);
  }
  for (const asset of incoming ?? []) {
    if (asset.originalUrl && asset.url) byOriginalUrl.set(asset.originalUrl, asset);
  }
  return [...byOriginalUrl.values()];
}

function bookmarkReadableMarkdown(
  readableMarkdown: string,
  assets: BookmarkCaptureAsset[] | undefined,
): string {
  const replacements = new Map<string, string>();
  for (const asset of assets ?? []) {
    if (asset.originalUrl && asset.url) replacements.set(asset.originalUrl, asset.url);
  }
  return localizeRemoteMarkdownImages(readableMarkdown, replacements).trim();
}

export function shouldRefreshBookmarkReadable(
  currentBody: string,
  nextBody: string,
  assets: BookmarkCaptureAsset[] | undefined,
): boolean {
  if (!nextBody) return false;
  if (!currentBody.trim()) return true;
  const currentImageCount = markdownImageCount(currentBody);
  const nextImageCount = markdownImageCount(nextBody);
  if (nextImageCount > currentImageCount) return true;
  const assetUrls = (assets ?? [])
    .map((asset) => asset.url?.trim())
    .filter((url): url is string => Boolean(url));
  if (assetUrls.length === 0) return false;
  const nextSavedImageCount = assetUrls.filter((url) => nextBody.includes(url)).length;
  const currentSavedImageCount = assetUrls.filter((url) =>
    currentBody.includes(url),
  ).length;
  return nextSavedImageCount > currentSavedImageCount;
}

export function shouldReplaceBookmarkReadableAfterRecapture(
  currentBody: string,
  nextBody: string,
  previousCapture: BookmarkCapture | null | undefined,
  nextAssets: BookmarkCaptureAsset[] | undefined,
): boolean {
  if (!nextBody) return false;
  if (!currentBody.trim()) return true;
  const previousAssetUrls = (previousCapture?.assets ?? [])
    .map((asset) => asset.url?.trim())
    .filter((url): url is string => Boolean(url));
  if (previousAssetUrls.some((url) => currentBody.includes(url))) return true;
  const previousUrl = previousCapture?.url?.trim();
  if (previousUrl && currentBody.slice(0, 1024).includes(`](${previousUrl})`)) {
    return true;
  }
  return shouldRefreshBookmarkReadable(currentBody, nextBody, nextAssets);
}

function markdownImageCount(markdown: string): number {
  return markdown.match(
    /!\[[^\]]*]\(\s*<?(?:https?:\/\/|\/|\.\/|\.\.\/)[^\s<>)]+>?/gi,
  )?.length ?? 0;
}

/** Enter a fresh bookmark into the capture pipeline. */
export async function markCapturePending(
  handle: string,
  postId: string,
  url: string,
): Promise<Post | null> {
  if (!db) return null;
  const blogId = await blogIdFor(handle);
  const existing = await db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.blogId, blogId),
        eq(posts.type, "bookmark"),
        isNull(posts.deletedAt),
      ),
    )
    .limit(1);
  const row = existing[0];
  if (!row) return null;

  const capture = startCaptureGeneration(row.capture, {
    id: randomUUID(),
    url,
    startedAt: new Date().toISOString(),
  });
  delete capture.error;

  const updated = await db
    .update(posts)
    .set({ captureStatus: "pending", capture, updatedAt: new Date() })
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.blogId, blogId),
        eq(posts.type, "bookmark"),
        isNull(posts.deletedAt),
      ),
    )
    .returning();
  return updated[0] ? mapPost(updated[0]) : null;
}

/**
 * Move a document into a folder by path. Presentation and visibility belong to
 * the document, so moving never changes either one.
 */
export async function setPostFolder(
  handle: string,
  postId: string,
  folderPath: string,
): Promise<Post | null> {
  if (!db) return null;
  const blogId = await blogIdFor(handle);
  const target = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.blogId, blogId),
        eq(folders.path, folderPath),
        isNull(folders.deletedAt),
      ),
    )
    .limit(1);
  const folder = target[0];
  if (!folder) throw new Error(`unknown folder "${folderPath}"`);
  const existing = await db
    .select()
    .from(posts)
    .where(
      and(eq(posts.id, postId), eq(posts.blogId, blogId), isNull(posts.deletedAt)),
    )
    .limit(1);
  const row = existing[0];
  if (!row) throw new Error("Post not found");
  if (row.visibility === "public" && row.folderId !== folder.id) {
    await assertPublicPathAvailable(blogId, folder.path, row.slug, row.id);
  }
  let updated: PostRow[];
  try {
    updated = await db
      .update(posts)
      .set({ folderId: folder.id, updatedAt: new Date() })
      .where(eq(posts.id, row.id))
      .returning();
  } catch (error) {
    if (isPostsSlugConflict(error)) throw new Error("That URL is already used");
    throw error;
  }
  if (!updated[0]) return null;
  await recordAction({
    actorType: "human",
    actionName: "move_document",
    targetType: "item",
    targetId: row.id,
    inputSummary: row.folderId ?? "root",
    outputSummary: folder.id,
  });
  return mapPost(updated[0]);
}

/**
 * Move (change folder) and/or rename (change slug) a post in ONE update that
 * touches only folder_id and slug, never the body. The sync PATCH route maps a
 * File Provider reparent/rename here; keeping the update to those two columns
 * means a content PUT that lands concurrently can never be clobbered by a stale
 * full-row save (which re-sending the whole `post` would do). Returns the post,
 * whether a write occurred, and the prior slug; null means the post no longer
 * exists. Throws on an unknown target folder, a stale base, or a slug collision.
 */
export async function movePostFile(
  handle: string,
  postId: string,
  changes: {
    folderId?: string;
    slug?: string;
    title?: string;
    expectedRevision?: number;
  },
  audit?: AuditEntry,
): Promise<
  | { post: Post; changed: boolean; previousSlug: string }
  | null
> {
  if (!db) return null;
  const blogId = await blogIdFor(handle);
  const existing = await db
    .select()
    .from(posts)
    .where(
      and(eq(posts.id, postId), eq(posts.blogId, blogId), isNull(posts.deletedAt)),
    )
    .limit(1);
  const row = existing[0];
  if (!row) return null;
  if (
    changes.expectedRevision !== undefined &&
    row.revision !== changes.expectedRevision
  ) {
    throw new PostConflictError();
  }

  const set: {
    updatedAt: Date;
    folderId?: string;
    slug?: string;
    title?: string;
    document?: DocumentSnapshot;
  } = {
    updatedAt: new Date(),
  };
  let destinationFolderPath: string | undefined;

  if (changes.folderId !== undefined) {
    const target = await db
      .select()
      .from(folders)
      .where(
        and(
          eq(folders.blogId, blogId),
          eq(folders.id, changes.folderId),
          isNull(folders.deletedAt),
        ),
      )
      .limit(1);
    const folder = target[0];
    if (!folder) throw new Error(`unknown folder "${changes.folderId}"`);
    // Only a real move counts: setting folder_id to the folder it is already in
    // would still run the update and bump the revision, making a same-folder
    // PATCH look like a change to every client.
    if (folder.id !== row.folderId) set.folderId = folder.id;
    destinationFolderPath = folder.path;
  }

  if (changes.slug !== undefined) {
    const slug = sanitizePostSlug(changes.slug, row.slug);
    if (slug !== row.slug) set.slug = slug;
  }

  // A Finder rename retitles the post (the filename is the title). Only a real
  // change counts, so a rename to the same title is a no-op like a same-folder
  // move. The slug/URL is deliberately left alone (rename != reslug).
  if (changes.title !== undefined && changes.title !== row.title) {
    set.title = changes.title;
    const document = requireDocumentSnapshot(
      row.document,
      `Persisted item ${row.id}`,
    );
    set.document = validateDocumentSnapshot({
      ...document,
      content: { ...document.content, title: changes.title },
    });
  }

  // Nothing actually changes (same folder, same slug, same title): return the
  // current row untouched rather than bump the revision and spuriously advance
  // the change cursor, which would make a no-op PATCH look like a real edit.
  if (
    set.folderId === undefined &&
    set.slug === undefined &&
    set.title === undefined
  ) {
    return { post: mapPost(row), changed: false, previousSlug: row.slug };
  }

  if (row.visibility === "public" && (set.folderId || set.slug)) {
    if (!destinationFolderPath) {
      const currentFolder = row.folderId
        ? await getFolderById(handle, row.folderId)
        : await getFolderByPath(handle, BLOG_FOLDER_PATH);
      destinationFolderPath = currentFolder?.path;
    }
    if (!destinationFolderPath) throw new Error("Folder not found");
    await assertPublicPathAvailable(
      blogId,
      destinationFolderPath,
      set.slug ?? row.slug,
      row.id,
    );
  }

  // The revision guard makes the move atomic: if a concurrent writer committed
  // between the select above and this update, the revision no longer matches and
  // we conflict instead of overwriting their metadata change.
  const guard =
    changes.expectedRevision !== undefined
      ? [eq(posts.revision, changes.expectedRevision)]
      : [];
  const where = and(
    eq(posts.id, row.id),
    eq(posts.blogId, blogId),
    isNull(posts.deletedAt),
    ...guard,
  );
  try {
    let movedId: string | undefined;
    if (audit) {
      // Atomic: the metadata move and its audit row commit in ONE neon-http
      // transaction. The drizzle UPDATE is embedded as the CTE body so its
      // columns/params are built by the query builder (no hand-written SQL),
      // and the audit lands iff the guard matched a row.
      // No parens around ${updateQuery}: drizzle renders an embedded statement
      // already wrapped in parens, so `AS ${q}` yields the single-paren CTE body
      // `AS (update ...)`. Wrapping it again would produce `AS ((update ...))`,
      // which Postgres rejects as a syntax error.
      const updateQuery = db.update(posts).set(set).where(where).returning({ id: posts.id });
      const auditCte = auditCteFrom(audit, "changed", sql`changed.id::text`);
      const result = await db.execute(sql`
        WITH changed AS ${updateQuery}, audit AS (${auditCte})
        SELECT id FROM changed
      `);
      movedId = (result.rows[0] as { id?: string } | undefined)?.id;
    } else {
      const updated = await db.update(posts).set(set).where(where).returning({ id: posts.id });
      movedId = updated[0]?.id;
    }
    if (movedId) {
      // Re-read the mapped row (the CTE returns raw columns; a fresh select
      // keeps the drizzle mapping and reflects the trigger-assigned revision).
      const [fresh] = await db
        .select()
        .from(posts)
        .where(and(eq(posts.id, row.id), eq(posts.blogId, blogId)))
        .limit(1);
      return {
        post: mapPost(fresh ?? row),
        changed: true,
        previousSlug: row.slug,
      };
    }
    // Guarded and matched nothing: the row moved under us (the select saw it,
    // the guarded update did not). A conflict, not a silent no-op.
    if (changes.expectedRevision !== undefined) throw new PostConflictError();
    return null;
  } catch (error) {
    if (isPostsSlugConflict(error)) throw new Error("That URL is already used");
    throw error;
  }
}

/** One folder by its full path, or null. */
export async function getFolderByPath(
  handle: string,
  path: string,
): Promise<Folder | null> {
  if (!db) throw new Error(NO_DATABASE);
  const blogId = await blogIdFor(handle);
  const rows = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.blogId, blogId),
        eq(folders.path, path),
        isNull(folders.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ? mapFolder(rows[0]) : null;
}

/** One folder by its id within the blog, or null. */
export async function getFolderById(
  handle: string,
  folderId: string,
): Promise<Folder | null> {
  if (!db) throw new Error(NO_DATABASE);
  const blogId = await blogIdFor(handle);
  const rows = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.id, folderId),
        eq(folders.blogId, blogId),
        isNull(folders.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ? mapFolder(rows[0]) : null;
}

/** The public post kind a folder mode files new items as. */
export function defaultPostTypeForFolderMode(mode: FolderMode): PostType {
  switch (mode) {
    case "notes":
      return "note";
    case "bookmarks":
      return "bookmark";
    default:
      return "article";
  }
}

type CreateDraftOptions = {
  representation?: FileRepresentation;
  template?: { id: string; version: number };
  audit?: AuditEntry;
};

/**
 * Create an empty draft directly inside a specific folder (a File Provider
 * create knows the target folder, unlike the compatibility createDraft). New
 * documents inherit the folder's template and are private until explicitly
 * shared or published.
 */
export async function createDraftInFolder(
  handle: string,
  folderId: string,
  options: CreateDraftOptions = {},
): Promise<Post> {
  if (!db) throw new Error("createDraftInFolder requires DATABASE_URL");
  const folder = await getFolderById(handle, folderId);
  if (!folder) throw new Error("Folder not found");
  const template =
    options.template ??
    folder.defaultTemplate ?? {
      id: legacyTemplateId(defaultPostTypeForFolderMode(folder.mode)),
      version: 1,
    };
  const document = emptyDocumentSnapshot(template);
  const type = defaultPostTypeForFolderMode(folder.mode);
  const blogId = await blogIdFor(handle);
  const slug = `untitled-${Date.now().toString(36)}`;
  const inserted = await db
    .insert(posts)
    .values({
      blogId,
      folderId: folder.id,
      representation:
        options.representation ?? DEFAULT_FILE_REPRESENTATION,
      document,
      visibility: "private",
      templateId: template.id,
      templateVersion: template.version,
      type,
      slug,
      title: "",
      excerpt: "",
      body: "",
      wordCount: 0,
      status: "draft",
    })
    .returning();
  const created = mapPost(inserted[0]);
  await recordAction(
    options.audit ?? {
      actorType: "human",
      actionName: "create_document",
      targetType: "item",
      targetId: created.id,
      outputSummary: `${template.id}@${template.version}`,
    },
  );
  return created;
}

function cleanFolderMode(value: string | null): FolderMode {
  if (value === "notes" || value === "bookmarks") return value;
  return "blog";
}

async function workspaceFoldersByBlogId(blogId: string): Promise<Folder[]> {
  if (!db) throw new Error(NO_DATABASE);
  const rows = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.blogId, blogId),
        inArray(
          folders.path,
          WORKSPACE_FOLDERS.map((folder) => folder.path),
        ),
        isNull(folders.deletedAt),
      ),
    )
    .orderBy(asc(folders.position), asc(folders.createdAt));
  return rows.map(mapFolder);
}

// Provision ALL system folders: one multi-row INSERT with ON CONFLICT DO
// NOTHING settles races on the (blog, path) partial unique index, same pattern
// as blogs, then one SELECT reads the settled rows back in order.
export async function ensureWorkspaceFolders(blogId: string): Promise<Folder[]> {
  if (!db) throw new Error(NO_DATABASE);
  await db
    .insert(folders)
    .values(
      WORKSPACE_FOLDERS.map((folder) => ({
        blogId,
        name: folder.name,
        path: folder.path,
        mode: folder.mode,
        position: folder.position,
        parentId: folder.parentId,
        defaultTemplateId:
          folder.defaultTemplate?.id ?? "texttext.article",
        defaultTemplateVersion: folder.defaultTemplate?.version ?? 1,
      })),
    )
    .onConflictDoNothing();
  const rows = await workspaceFoldersByBlogId(blogId);
  if (rows.length < WORKSPACE_FOLDERS.length) {
    throw new Error("failed to ensure the workspace folders");
  }
  return rows;
}

async function provisionNewWorkspaceDefaults(blogId: string): Promise<void> {
  const workspaceFolders = await ensureWorkspaceFolders(blogId);
  const folderIdByPath = new Map(
    workspaceFolders.map((folder) => [folder.path, folder.id]),
  );
  const blogFolderId = folderIdByPath.get(folderPathForPostType("article"));
  const notesFolderId = folderIdByPath.get(folderPathForPostType("note"));
  const bookmarksFolderId = folderIdByPath.get(folderPathForPostType("bookmark"));
  if (!blogFolderId || !notesFolderId || !bookmarksFolderId) {
    throw new Error("failed to resolve the workspace folders");
  }
  // A new workspace starts with the two AI guides in Notes (owner decision
  // 2026-08-14, reversing the empty-by-default of 2026-08-08): the paths for
  // connecting an AI must be discoverable from the very first Library view,
  // not only from the docs site. They are private notes, they are marked as
  // starter posts so caps and cleanups know them, and the first visit to the
  // editor still creates the person's own first draft.
  void blogFolderId;
  void bookmarksFolderId;
  await db!
    .insert(posts)
    .values(starterAgentGuideValues(blogId, notesFolderId))
    .onConflictDoNothing({
      target: [posts.folderId, posts.slug],
      where: sql`${posts.deletedAt} is null`,
    });

  // Provisioning is a mutation like any other; without this row the starter
  // posts are the only content that appears with no audit trail.
  await recordAction({
    actorType: "human",
    actionName: "provision_workspace_defaults",
    targetType: "workspace",
    targetId: blogId,
    inputSummary: "workspace folders",
  });
}

/**
 * Add the durable AI connection and live-canvas guides to workspaces created
 * before they became provisioning defaults. Safe to run on every release.
 */
export async function backfillWorkspaceAgentGuides(): Promise<{
  workspaces: number;
  inserted: number;
}> {
  if (!db) return { workspaces: 0, inserted: 0 };

  const workspaceRows = await db.select({ id: blogs.id }).from(blogs);
  let inserted = 0;

  for (const workspace of workspaceRows) {
    const workspaceFolders = await ensureWorkspaceFolders(workspace.id);
    const notesFolder = workspaceFolders.find(
      (folder) => folder.path === folderPathForPostType("note"),
    );
    if (!notesFolder) {
      throw new Error(`notes folder missing for workspace ${workspace.id}`);
    }

    const added = await db
      .insert(posts)
      .values(starterAgentGuideValues(workspace.id, notesFolder.id))
      .onConflictDoNothing({
        target: [posts.folderId, posts.slug],
        where: sql`${posts.deletedAt} is null`,
      })
      .returning({ id: posts.id });

    if (added.length > 0) {
      inserted += added.length;
      await recordAction({
        actorType: "external_agent",
        actionName: "backfill_workspace_agent_guides",
        targetType: "workspace",
        targetId: workspace.id,
        inputSummary: `${added.length} private AI guide notes`,
      });
    }
  }

  return { workspaces: workspaceRows.length, inserted };
}

// The system folder a post of this type belongs in. New blogs are provisioned
// at creation, and older blogs are covered by the backfill migration.
async function folderForPostType(
  blogId: string,
  type: PostType,
): Promise<Folder> {
  const path = folderPathForPostType(type);
  const rows = await db!
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.blogId, blogId),
        eq(folders.path, path),
        isNull(folders.deletedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new Error(`missing the "${path}" workspace folder`);
  return mapFolder(rows[0]);
}

async function getFoldersUncached(handle: string): Promise<Folder[]> {
  if (!db) throw new Error(NO_DATABASE);
  const rows = await db
    .select({
      id: folders.id,
      blogId: folders.blogId,
      name: folders.name,
      path: folders.path,
      parentId: folders.parentId,
      mode: folders.mode,
      defaultTemplateId: folders.defaultTemplateId,
      defaultTemplateVersion: folders.defaultTemplateVersion,
      position: folders.position,
      createdAt: folders.createdAt,
      updatedAt: folders.updatedAt,
      deletedAt: folders.deletedAt,
    })
    .from(folders)
    .innerJoin(blogs, eq(folders.blogId, blogs.id))
    .where(
      and(
        eq(blogs.handle, handle),
        isNull(blogs.deletedAt),
        isNull(folders.deletedAt),
      ),
    )
    .orderBy(asc(folders.position), asc(folders.createdAt));
  return rows.map(mapFolder);
}

const getFoldersCached = cache(getFoldersUncached);

export async function getFolders(handle: string): Promise<Folder[]> {
  return getFoldersCached(handle);
}

// Posts scoped to one folder of the workspace, identified by its path. Posts
// with a NULL folder_id (created before the folders backfill) count as living
// in the default "blog" folder.
async function getFolderPostsUncached(
  handle: string,
  folderPath: string,
  publishedOnly: boolean,
): Promise<Post[]> {
  if (!db) throw new Error(NO_DATABASE);

  // The blog home ("blog") is the additive view of everything blog-mode: the
  // root plus every subfolder, so filing a post into a category keeps it on
  // the home (with a chip) rather than hiding it. A category page asks for an
  // exact subfolder path instead. Notes and bookmarks stay path-exact.
  const inFolder =
    folderPath === DEFAULT_FOLDER_PATH
      ? or(
          isNull(posts.folderId),
          eq(folders.path, folderPath),
          like(folders.path, `${folderPath}/%`),
        )
      : eq(folders.path, folderPath);
  const rows = await db
    .select(postListSelection())
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .leftJoin(
      folders,
      and(eq(posts.folderId, folders.id), isNull(folders.deletedAt)),
    )
    .where(
      and(
        eq(blogs.handle, handle),
        isNull(blogs.deletedAt),
        isNull(posts.deletedAt),
        publishedOnly ? ne(posts.type, "note") : undefined,
        publishedOnly ? ne(posts.type, "bookmark") : undefined,
        publishedOnly ? eq(posts.visibility, "public") : undefined,
        publishedOnly ? eq(posts.status, "published") : undefined,
        inFolder,
      ),
    )
    .orderBy(
      desc(posts.pinned),
      publishedOnly ? desc(posts.publishedAt) : desc(posts.updatedAt),
      desc(posts.createdAt),
    );
  const selected = rows.map(mapPostList);
  return publishedOnly
    ? selected.map(withoutPersonalWorkspaceMetadata)
    : selected;
}

const getFolderPostsCached = cache(getFolderPostsUncached);

export async function getFolderPosts(
  handle: string,
  folderPath: string,
  opts: { publishedOnly?: boolean } = {},
): Promise<Post[]> {
  return getFolderPostsCached(handle, folderPath, opts.publishedOnly ?? false);
}

async function selectFullPosts(
  handle: string,
  publishedOnly: boolean,
): Promise<Post[]> {
  const rows = await db!
    .select()
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      publishedOnly
        ? and(
            eq(blogs.handle, handle),
            eq(posts.visibility, "public"),
            eq(posts.status, "published"),
            ne(posts.type, "note"),
            ne(posts.type, "bookmark"),
            isNull(blogs.deletedAt),
            isNull(posts.deletedAt),
          )
        : and(
            eq(blogs.handle, handle),
            isNull(blogs.deletedAt),
            isNull(posts.deletedAt),
          ),
    )
    .orderBy(
      desc(posts.pinned),
      publishedOnly ? desc(posts.publishedAt) : desc(posts.updatedAt),
      desc(posts.createdAt),
    );
  const mapped = rows.map((r) => mapPost(r.posts));
  return publishedOnly
    ? mapped.map(withoutPersonalWorkspaceMetadata)
    : mapped;
}

async function getPublishedPostFilesUncached(handle: string): Promise<Post[]> {
  if (!db) throw new Error(NO_DATABASE);
  return selectFullPosts(handle, true);
}

const getPublishedPostFilesCached = cache(getPublishedPostFilesUncached);

export async function getPublishedPostFiles(handle: string): Promise<Post[]> {
  return getPublishedPostFilesCached(handle);
}

async function getAllPostFilesUncached(handle: string): Promise<Post[]> {
  if (!db) throw new Error(NO_DATABASE);
  return selectFullPosts(handle, false);
}

const getAllPostFilesCached = cache(getAllPostFilesUncached);

export async function getAllPostFiles(handle: string): Promise<Post[]> {
  return getAllPostFilesCached(handle);
}

async function getFolderPostFilesUncached(
  handle: string,
  folderPath: string,
  publishedOnly: boolean,
  exact: boolean,
): Promise<Post[]> {
  if (!db) throw new Error(NO_DATABASE);

  // The blog root normally absorbs its descendants (the public blog view lists
  // every article, wherever it is filed). The sync manifest asks for `exact`:
  // a File Provider tree must place each post in exactly one container, so the
  // root returns only its direct children and each subfolder lists its own.
  const inFolder =
    folderPath === DEFAULT_FOLDER_PATH
      ? exact
        ? or(isNull(posts.folderId), eq(folders.path, folderPath))
        : or(
            isNull(posts.folderId),
            eq(folders.path, folderPath),
            like(folders.path, `${folderPath}/%`),
          )
      : eq(folders.path, folderPath);
  const rows = await db
    .select()
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .leftJoin(
      folders,
      and(eq(posts.folderId, folders.id), isNull(folders.deletedAt)),
    )
    .where(
      and(
        eq(blogs.handle, handle),
        isNull(blogs.deletedAt),
        isNull(posts.deletedAt),
        publishedOnly ? ne(posts.type, "note") : undefined,
        publishedOnly ? ne(posts.type, "bookmark") : undefined,
        publishedOnly ? eq(posts.visibility, "public") : undefined,
        publishedOnly ? eq(posts.status, "published") : undefined,
        inFolder,
      ),
    )
    .orderBy(
      desc(posts.pinned),
      publishedOnly ? desc(posts.publishedAt) : desc(posts.updatedAt),
      desc(posts.createdAt),
    );
  const selected = rows.map((r) => mapPost(r.posts));
  return publishedOnly
    ? selected.map(withoutPersonalWorkspaceMetadata)
    : selected;
}

const getFolderPostFilesCached = cache(getFolderPostFilesUncached);

export async function getFolderPostFiles(
  handle: string,
  folderPath: string,
  opts: { publishedOnly?: boolean; exact?: boolean } = {},
): Promise<Post[]> {
  return getFolderPostFilesCached(
    handle,
    folderPath,
    opts.publishedOnly ?? false,
    opts.exact ?? false,
  );
}

// Live (not trashed) item counts per folder path, drafts included, in one
// grouped query. A NULL folder_id counts toward the default "blog" folder.
async function getFolderCountsUncached(handle: string): Promise<Record<string, number>> {
  if (!db) throw new Error(NO_DATABASE);
  const rows = await db
    .select({ path: folders.path, count: sql<number>`count(*)::int` })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .leftJoin(
      folders,
      and(eq(posts.folderId, folders.id), isNull(folders.deletedAt)),
    )
    .where(
      and(
        eq(blogs.handle, handle),
        isNull(blogs.deletedAt),
        isNull(posts.deletedAt),
      ),
    )
    .groupBy(folders.path);
  const counts: Record<string, number> = {};
  for (const row of rows) {
    // The left join leaves path NULL for unbackfilled posts; those are blog's.
    const path = row.path ?? DEFAULT_FOLDER_PATH;
    counts[path] = (counts[path] ?? 0) + Number(row.count);
  }
  return counts;
}

const getFolderCountsCached = cache(getFolderCountsUncached);

export async function getFolderCounts(
  handle: string,
): Promise<Record<string, number>> {
  return getFolderCountsCached(handle);
}

async function getPostFolderRowsUncached(handle: string): Promise<PostFolderRow[]> {
  if (!db) return [];
  const rows = await db
    .select({ id: posts.id, folderId: posts.folderId, type: posts.type })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      and(
        eq(blogs.handle, handle),
        isNull(blogs.deletedAt),
        isNull(posts.deletedAt),
      ),
    );
  return rows;
}

const getPostFolderRows = cache(getPostFolderRowsUncached);

export async function getAccessibleFolders(
  handle: string,
  user: AccessUser | null,
): Promise<Folder[]> {
  if (!db || !user) return [];
  const allFolders = await getFolders(handle);
  const ids = await accessibleFolderIdsForUser(handle, user);
  if (ids === "all") return allFolders;
  return allFolders.filter((folder) => ids.has(folder.id));
}

export async function getAccessibleFolderPosts(
  handle: string,
  folderPath: string,
  user: AccessUser | null,
  opts: { publishedOnly?: boolean } = {},
): Promise<Post[]> {
  if (!db || !user) return [];
  const folderPosts = await getFolderPosts(handle, folderPath, opts);
  const ids = await accessiblePostIdsForUser(handle, user);
  if (ids === "all") return folderPosts;
  return folderPosts.filter((post) => Boolean(post.id && ids.has(post.id)));
}

export async function getAccessibleFolderPostFiles(
  handle: string,
  folderPath: string,
  user: AccessUser | null,
  opts: { publishedOnly?: boolean; exact?: boolean } = {},
): Promise<Post[]> {
  if (!db || !user) return [];
  const folderPosts = await getFolderPostFiles(handle, folderPath, opts);
  const ids = await accessiblePostIdsForUser(handle, user);
  if (ids === "all") return folderPosts;
  return folderPosts.filter((post) => Boolean(post.id && ids.has(post.id)));
}

export async function getAccessibleAllPosts(
  handle: string,
  user: AccessUser | null,
): Promise<Post[]> {
  if (!db || !user) return [];
  const allPosts = await getAllPosts(handle);
  const ids = await accessiblePostIdsForUser(handle, user);
  if (ids === "all") return allPosts;
  return allPosts.filter((post) => Boolean(post.id && ids.has(post.id)));
}

export async function getAccessibleAllPostFiles(
  handle: string,
  user: AccessUser | null,
): Promise<Post[]> {
  if (!db || !user) return [];
  const allPosts = await getAllPostFiles(handle);
  const ids = await accessiblePostIdsForUser(handle, user);
  if (ids === "all") return allPosts;
  return allPosts.filter((post) => Boolean(post.id && ids.has(post.id)));
}

export async function getAccessibleFolderCounts(
  handle: string,
  user: AccessUser | null,
): Promise<Record<string, number>> {
  if (!db || !user) return {};
  const [allFolders, postRows, visiblePostIds, visibleFolderIds] = await Promise.all([
    getFolders(handle),
    getPostFolderRows(handle),
    accessiblePostIdsForUser(handle, user),
    accessibleFolderIdsForUser(handle, user),
  ]);
  const pathById = new Map(allFolders.map((folder) => [folder.id, folder.path]));
  const visiblePaths =
    visibleFolderIds === "all"
      ? new Set(allFolders.map((folder) => folder.path))
      : new Set(
          allFolders
            .filter((folder) => visibleFolderIds.has(folder.id))
            .map((folder) => folder.path),
        );
  const counts: Record<string, number> = {};
  for (const post of postRows) {
    if (visiblePostIds !== "all" && !visiblePostIds.has(post.id)) continue;
    const path = post.folderId ? pathById.get(post.folderId) : DEFAULT_FOLDER_PATH;
    if (!path || !visiblePaths.has(path)) continue;
    counts[path] = (counts[path] ?? 0) + 1;
  }
  return counts;
}

/** The owner's pricing plan for a blog, or null when it has no owner. */
export async function getOwnerPlan(handle: string): Promise<string | null> {
  if (!db) return null;
  return (await getBlogCore(handle))?.ownerPlan ?? null;
}

async function getBlogEditRecordUncached(
  handle: string,
): Promise<BlogEditRecord | null> {
  if (!db) return null;
  const row = await getBlogCore(handle);
  if (!row) return null;
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    ownerId: row.ownerId,
  };
}

const getBlogEditRecordCached = cache(getBlogEditRecordUncached);

export async function getBlogEditRecord(
  handle: string,
): Promise<BlogEditRecord | null> {
  return getBlogEditRecordCached(handle);
}

async function getPostByIdUncached(
  handle: string,
  id: string,
): Promise<Post | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      and(
        eq(blogs.handle, handle),
        eq(posts.id, id),
        isNull(blogs.deletedAt),
        isNull(posts.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ? mapPost(rows[0].posts) : null;
}

const getPostByIdCached = cache(getPostByIdUncached);

export async function getPostById(
  handle: string,
  id: string,
): Promise<Post | null> {
  return getPostByIdCached(handle, id);
}

export type PostStoreContext = {
  blogId: string;
  handle: string;
  post: Post;
};

/** Resolve an item and its tenant for authenticated routes that start with an
 * opaque item id. Content routes use this instead of querying posts directly,
 * keeping deletion filtering and stored-content mapping inside the store. */
export async function getPostStoreContext(
  id: string,
): Promise<PostStoreContext | null> {
  if (!db) return null;
  const rows = await db
    .select({ blogId: blogs.id, handle: blogs.handle, post: posts })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      and(
        eq(posts.id, id),
        isNull(blogs.deletedAt),
        isNull(posts.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row
    ? { blogId: row.blogId, handle: row.handle, post: mapPost(row.post) }
    : null;
}

function cleanCapabilityRole(value: string): DocumentCapabilityRole {
  if (value === "editor" || value === "commenter") return value;
  return "viewer";
}

function mapDocumentCapability(
  row: typeof documentCapabilityLinks.$inferSelect,
): DocumentCapability {
  return {
    id: row.id,
    itemId: row.postId,
    role: cleanCapabilityRole(row.role),
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

function capabilityTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function getDocumentTemplate(
  blogId: string,
  reference: TemplateReference,
): Promise<TemplateDefinition | null> {
  const builtin = getBuiltinTemplate(reference.id, reference.version);
  if (builtin) return builtin;
  if (!db) return null;
  const rows = await db
    .select({ definition: documentTemplates.definition })
    .from(documentTemplates)
    .where(
      and(
        eq(documentTemplates.blogId, blogId),
        eq(documentTemplates.templateId, reference.id),
        eq(documentTemplates.version, reference.version),
      ),
    )
    .limit(1);
  return rows[0] ? validateTemplateDefinition(rows[0].definition) : null;
}

/**
 * The collection layout of the look governing a folder's index page.
 *
 * Null when the folder has no look of its own, which is the caller's signal to
 * fall back. A folder's look is the single answer to "how does this folder's
 * index render"; the workspace used to have a second answer for the Blog page
 * in particular, stored on the blog row, and two answers to one question is
 * how that surface became confusing.
 */
export async function getFolderCollectionLayout(
  handle: string,
  folderPath: string,
): Promise<TemplateDefinition["collection"]["layout"] | null> {
  const folders = await getFolders(handle);
  const reference = folders.find(
    (folder) => folder.path === folderPath,
  )?.defaultTemplate;
  if (!reference) return null;
  const blogId = await blogIdFor(handle);
  const template = await getDocumentTemplate(blogId, reference);
  return template?.collection.layout ?? null;
}

/**
 * The looks available to CHOOSE from: one entry per template, at its current
 * version.
 *
 * Template versions are immutable and every document pins an exact one, which
 * is what keeps a newer version from restyling documents behind their authors.
 * But that made this return every version ever written, so customizing a look
 * twice put two identically named cards in the picker and a third put three.
 * Picking a look means picking its current version; older versions stay
 * resolvable through getDocumentTemplate for the documents already on them.
 */
export async function listDocumentTemplates(
  blogId: string,
): Promise<TemplateDefinition[]> {
  if (!db) return [...BUILTIN_TEMPLATES];
  const rows = await db
    .select({
      templateId: documentTemplates.templateId,
      definition: documentTemplates.definition,
    })
    .from(documentTemplates)
    .where(
      and(
        eq(documentTemplates.blogId, blogId),
        isNull(documentTemplates.retiredAt),
      ),
    )
    .orderBy(asc(documentTemplates.templateId), desc(documentTemplates.version));
  const latest: TemplateDefinition[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.templateId)) continue;
    seen.add(row.templateId);
    latest.push(validateTemplateDefinition(row.definition));
  }
  return [...BUILTIN_TEMPLATES, ...latest];
}

export async function createDocumentTemplateVersion(input: {
  blogId: string;
  definition: TemplateDefinition;
  actor: AuditEntry;
  createdById?: string | null;
}): Promise<TemplateDefinition> {
  if (!db) throw new Error("createDocumentTemplateVersion requires DATABASE_URL");
  const candidate = validateTemplateDefinition(input.definition);
  if (candidate.id.startsWith("texttext.")) {
    throw new Error("Built-in template identifiers cannot be replaced");
  }
  const latest = await db
    .select({ version: documentTemplates.version })
    .from(documentTemplates)
    .where(
      and(
        eq(documentTemplates.blogId, input.blogId),
        eq(documentTemplates.templateId, candidate.id),
      ),
    )
    .orderBy(desc(documentTemplates.version))
    .limit(1);
  const definition = validateTemplateDefinition({
    ...candidate,
    version: (latest[0]?.version ?? 0) + 1,
  });
  await db.insert(documentTemplates).values({
    blogId: input.blogId,
    templateId: definition.id,
    version: definition.version,
    name: definition.name,
    definition,
    createdById: input.createdById ?? null,
  });
  await recordAction({
    ...input.actor,
    actionName: "create_document_template_version",
    targetType: "mode",
    targetId: `${definition.id}@${definition.version}`,
    outputSummary: definition.name,
  });
  return definition;
}

/**
 * Save the look of one document as a reusable look.
 *
 * This replaced an authoring API. A person used to be unable to make a look at
 * all, and an agent could only do it by sending up to 32 operations from a
 * closed vocabulary, declaring fields, and rebinding both the item and the
 * collection composition in one call or having the whole thing rejected. The
 * tool's own description needed an eight-line procedure and a list of the rules
 * that caused most rejections, which is a fair sign no person was ever going to
 * use it.
 *
 * A look is a template plus the theme the document carries, so saving one is
 * just: resolve what this document is already rendering with, fold in its
 * theme, give it a name. You design by editing a document normally, which is
 * how Notion has always done it.
 */
export async function saveDocumentAsLook(input: {
  blogId: string;
  handle: string;
  postId: string;
  name: string;
  actor: AuditEntry;
  createdById?: string | null;
}): Promise<TemplateDefinition> {
  if (!db) throw new Error(NO_DATABASE);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Give the look a name.");
  if (name.length > 160) throw new Error("That name is too long.");

  const post = await getPostById(input.handle, input.postId);
  if (!post) throw new Error("That item could not be found.");
  const document = post.document;
  if (!document) throw new Error("That item has no document to take a look from.");

  const reference = document.presentation.template;
  const base = await getDocumentTemplate(input.blogId, reference);
  if (!base) throw new Error("That item's current look could not be read.");

  // A workspace look never uses the reserved prefix, and two looks saved from
  // the same name must not collide, so the id carries a short suffix.
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "look";
  const templateId = `${slug}-${randomUUID().slice(0, 6)}`;

  const definition = validateTemplateDefinition({
    ...base,
    id: templateId,
    version: 1,
    name,
    // The document's own theme is what makes it look the way it does; without
    // this the saved look would be the base template again under a new name.
    theme: { ...base.theme, ...document.presentation.theme },
  });

  return createDocumentTemplateVersion({
    blogId: input.blogId,
    definition,
    actor: input.actor,
    createdById: input.createdById ?? null,
  });
}

/**
 * Retire a workspace look: stop offering it, keep every document that wears it
 * rendering exactly as it does.
 *
 * Every version of the template id is marked, because a look is the thing a
 * person retires, not one of its versions. Nothing is deleted: versions are
 * immutable and documents pin exact ones, so a delete would leave those
 * documents pointing at a row that is gone. Built-ins cannot be retired.
 */
export async function retireDocumentTemplate(
  blogId: string,
  templateId: string,
): Promise<boolean> {
  if (!db) throw new Error(NO_DATABASE);
  if (templateId.startsWith("texttext.")) {
    throw new Error("Built-in looks cannot be retired.");
  }
  const rows = await db
    .update(documentTemplates)
    .set({ retiredAt: new Date() })
    .where(
      and(
        eq(documentTemplates.blogId, blogId),
        eq(documentTemplates.templateId, templateId),
        isNull(documentTemplates.retiredAt),
      ),
    )
    .returning({ templateId: documentTemplates.templateId });
  return rows.length > 0;
}

export async function createDocumentCapability(input: {
  itemId: string;
  role: DocumentCapabilityRole;
  label?: string | null;
  expiresAt?: Date | null;
  createdById?: string | null;
  actor: AuditEntry;
}): Promise<CreatedDocumentCapability> {
  if (!db) throw new Error("createDocumentCapability requires DATABASE_URL");
  const token = randomBytes(32).toString("base64url");
  const rows = await db
    .insert(documentCapabilityLinks)
    .values({
      postId: input.itemId,
      tokenHash: capabilityTokenHash(token),
      role: input.role,
      label: input.label?.trim() || null,
      expiresAt: input.expiresAt ?? null,
      createdById: input.createdById ?? null,
    })
    .returning();
  const capability = mapDocumentCapability(rows[0]);
  await recordAction({
    ...input.actor,
    actionName: "create_document_capability",
    targetType: "item",
    targetId: input.itemId,
    outputSummary: `${input.role}:${capability.id}`,
  });
  return { ...capability, token };
}

export async function revokeDocumentCapability(input: {
  itemId: string;
  capabilityId: string;
  actor: AuditEntry;
}): Promise<boolean> {
  if (!db) throw new Error("revokeDocumentCapability requires DATABASE_URL");
  const rows = await db
    .update(documentCapabilityLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(documentCapabilityLinks.id, input.capabilityId),
        eq(documentCapabilityLinks.postId, input.itemId),
        isNull(documentCapabilityLinks.revokedAt),
      ),
    )
    .returning({ id: documentCapabilityLinks.id });
  if (!rows[0]) return false;
  await recordAction({
    ...input.actor,
    actionName: "revoke_document_capability",
    targetType: "item",
    targetId: input.itemId,
    inputSummary: input.capabilityId,
  });
  return true;
}

export async function resolveDocumentCapability(
  token: string,
): Promise<ResolvedDocumentCapability | null> {
  if (!db || token.length < 32 || token.length > 256) return null;
  const rows = await db
    .select({ capability: documentCapabilityLinks, handle: blogs.handle })
    .from(documentCapabilityLinks)
    .innerJoin(posts, eq(documentCapabilityLinks.postId, posts.id))
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      and(
        eq(documentCapabilityLinks.tokenHash, capabilityTokenHash(token)),
        isNull(documentCapabilityLinks.revokedAt),
        or(
          isNull(documentCapabilityLinks.expiresAt),
          sql`${documentCapabilityLinks.expiresAt} > now()`,
        ),
        isNull(posts.deletedAt),
        isNull(blogs.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...mapDocumentCapability(row.capability), handle: row.handle };
}

function cleanItemCommentActorType(value: string): AuditActorType {
  if (value === "human" || value === "ai" || value === "external_agent") {
    return value;
  }
  throw new Error("Stored item comment has an invalid actor type");
}

function cleanItemCommentActor(
  actor: ItemCommentActorContext,
): ItemCommentActor & { actorName: string | null } {
  const actorType = cleanItemCommentActorType(actor.actorType);
  const actorUserId = actor.actorUserId ?? null;
  if (
    actorUserId !== null &&
    (typeof actorUserId !== "string" || actorUserId.trim() === "")
  ) {
    throw new Error("Comment actor user ID must be a non-empty string");
  }
  const actorName = actor.actorName?.replace(/\u0000/g, "").trim() || null;
  return { actorUserId, actorType, actorName };
}

function storedItemCommentActor(
  actorUserId: string | null,
  actorType: string | null,
): ItemCommentActor | null {
  if (!actorType) return null;
  return {
    actorUserId,
    actorType: cleanItemCommentActorType(actorType),
  };
}

function cleanItemCommentBody(value: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Comment body cannot be empty");
  }
  return value;
}

function cleanItemCommentAnchor(
  anchor:
    | ItemCommentAnchor
    | {
        field: ItemCommentAnchorField;
        exact?: string;
        start?: number;
        end?: number;
        startRelative?: string;
        endRelative?: string;
      }
    | null
    | undefined,
): {
  anchorField: ItemCommentAnchorField | null;
  anchorQuote: string | null;
  anchorStart: number | null;
  anchorEnd: number | null;
  anchorStartRelative: string | null;
  anchorEndRelative: string | null;
} {
  if (!anchor) {
    return {
      anchorField: null,
      anchorQuote: null,
      anchorStart: null,
      anchorEnd: null,
      anchorStartRelative: null,
      anchorEndRelative: null,
    };
  }
  if (
    anchor.field !== "title" &&
    anchor.field !== "excerpt" &&
    anchor.field !== "body"
  ) {
    throw new Error("Comment anchor field must be title, excerpt, or body");
  }
  const exactQuote =
    "exactQuote" in anchor && typeof anchor.exactQuote === "string"
      ? anchor.exactQuote
      : "exact" in anchor && typeof anchor.exact === "string"
        ? anchor.exact
        : "";
  if (exactQuote.trim() === "") {
    throw new Error("Comment anchor quote cannot be empty");
  }
  for (const [name, value] of [
    ["start", anchor.start],
    ["end", anchor.end],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`Comment anchor ${name} must be a non-negative integer`);
    }
  }
  if (
    anchor.start !== undefined &&
    anchor.end !== undefined &&
    anchor.end < anchor.start
  ) {
    throw new Error("Comment anchor end cannot be before its start");
  }
  const cleanRelative = (value: string | undefined, name: string) => {
    if (value === undefined) return null;
    if (
      value.length < 4 ||
      value.length > 2048 ||
      !/^[A-Za-z0-9+/_=-]+$/.test(value)
    ) {
      throw new Error(`Comment anchor ${name} is not valid encoded data`);
    }
    return value;
  };
  return {
    anchorField: anchor.field,
    anchorQuote: exactQuote,
    anchorStart: anchor.start ?? null,
    anchorEnd: anchor.end ?? null,
    anchorStartRelative: cleanRelative(anchor.startRelative, "start position"),
    anchorEndRelative: cleanRelative(anchor.endRelative, "end position"),
  };
}

function mapItemComment(row: ItemCommentRow): ItemComment {
  const author = storedItemCommentActor(row.authorUserId, row.authorActorType);
  if (!author) throw new Error("Stored item comment is missing its author");
  const anchor =
    row.anchorField && row.anchorQuote !== null
      ? {
          field: row.anchorField,
          exactQuote: row.anchorQuote,
          ...(row.anchorStart === null ? {} : { start: row.anchorStart }),
          ...(row.anchorEnd === null ? {} : { end: row.anchorEnd }),
          ...(row.anchorStartRelative === null
            ? {}
            : { startRelative: row.anchorStartRelative }),
          ...(row.anchorEndRelative === null
            ? {}
            : { endRelative: row.anchorEndRelative }),
        }
      : null;
  return {
    id: row.id,
    itemId: row.postId,
    parentId: row.parentId,
    body: row.body,
    anchor,
    author,
    authorName: row.authorName,
    editedBy: storedItemCommentActor(
      row.editedByUserId,
      row.editedByActorType,
    ),
    resolved: row.resolvedAt !== null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: storedItemCommentActor(
      row.resolvedByUserId,
      row.resolvedByActorType,
    ),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * List every comment for an item by default, including replies and resolved
 * threads. Authorization belongs to the caller; this function only scopes and
 * filters persistence rows.
 */
export async function listItemComments(
  itemId: string,
  options: ItemCommentListOptions = {},
): Promise<ItemComment[]> {
  if (!db) return [];
  const filters: SQL[] = [eq(itemComments.postId, itemId)];
  if (options.resolved === true) filters.push(isNotNull(itemComments.resolvedAt));
  if (options.resolved === false) filters.push(isNull(itemComments.resolvedAt));
  if (options.parentId === null) filters.push(isNull(itemComments.parentId));
  if (typeof options.parentId === "string") {
    filters.push(eq(itemComments.parentId, options.parentId));
  }
  const rows = await db
    .select()
    .from(itemComments)
    .where(and(...filters))
    .orderBy(asc(itemComments.createdAt), asc(itemComments.id));
  return rows.map(mapItemComment);
}

export function createItemComment(
  input: CreateItemCommentRequest,
): Promise<ItemComment>;
export function createItemComment(
  input: CreateItemCommentInput,
  actorContext: ItemCommentActorContext,
): Promise<ItemComment>;
export async function createItemComment(
  input: CreateItemCommentInput | CreateItemCommentRequest,
  ...actorContexts: [ItemCommentActorContext?]
): Promise<ItemComment> {
  if (!db) throw new Error("createItemComment requires DATABASE_URL");
  const record = input as unknown as Record<string, unknown>;
  const itemId =
    typeof input.itemId === "string" && input.itemId.trim()
      ? input.itemId
      : typeof record.postId === "string" && record.postId.trim()
        ? record.postId
        : null;
  if (!itemId) throw new Error("Comment item ID is required");
  const bodyValue =
    typeof input.body === "string" ? input.body : record.content;
  const body = cleanItemCommentBody(bodyValue as string);
  const embeddedActor =
    "actor" in input && input.actor && typeof input.actor === "object"
      ? input.actor
      : null;
  const actorUserId =
    typeof record.actorUserId === "string"
      ? record.actorUserId
      : typeof record.authorUserId === "string"
        ? record.authorUserId
        : typeof record.userId === "string"
          ? record.userId
          : null;
  const actorType =
    record.actorType === "ai" || record.actorType === "external_agent"
      ? record.actorType
      : "human";
  const actorName =
    typeof record.authorName === "string"
      ? record.authorName
      : typeof record.actorName === "string"
        ? record.actorName
        : null;
  const actor = cleanItemCommentActor(
    actorContexts[0] ??
      embeddedActor ?? {
        actorUserId,
        actorType,
        actorName,
      },
  );
  const anchor = cleanItemCommentAnchor(input.anchor);
  const parentIdValue = input.parentId ?? record.parentCommentId ?? null;
  if (
    parentIdValue !== null &&
    (typeof parentIdValue !== "string" || parentIdValue.trim() === "")
  ) {
    throw new Error("Parent comment ID must be a string");
  }
  const parentId = parentIdValue;

  // Replies are one level deep and cannot cross item boundaries. The parent
  // FK protects deletion races after this check.
  if (parentId) {
    const parents = await db
      .select({ id: itemComments.id })
      .from(itemComments)
      .where(
        and(
          eq(itemComments.id, parentId),
          eq(itemComments.postId, itemId),
          isNull(itemComments.parentId),
        ),
      )
      .limit(1);
    if (!parents[0]) throw new Error("Parent comment not found");
  }

  const inserted = await db
    .insert(itemComments)
    .values({
      postId: itemId,
      parentId,
      body,
      ...anchor,
      authorUserId: actor.actorUserId,
      authorName: actor.actorName,
      authorActorType: actor.actorType,
    })
    .returning();
  if (!inserted[0]) throw new Error("Failed to create comment");
  await recordAction({
    actorUserId: actor.actorUserId,
    actorType: actor.actorType,
    actionName: "create_item_comment",
    targetType: "item",
    targetId: itemId,
    outputSummary: inserted[0].id,
  });
  return mapItemComment(inserted[0]);
}

function hasOwnItemCommentKey<K extends keyof UpdateItemCommentInput>(
  patch: UpdateItemCommentInput,
  key: K,
): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

export async function updateItemComment(
  itemId: string,
  commentId: string,
  patch: UpdateItemCommentInput,
  actorContext: ItemCommentActorContext,
): Promise<ItemComment> {
  if (!db) throw new Error("updateItemComment requires DATABASE_URL");
  const changes: {
    body?: string;
    anchorField?: ItemCommentAnchorField | null;
    anchorQuote?: string | null;
    anchorStart?: number | null;
    anchorEnd?: number | null;
    anchorStartRelative?: string | null;
    anchorEndRelative?: string | null;
  } = {};
  if (hasOwnItemCommentKey(patch, "body")) {
    changes.body = cleanItemCommentBody(patch.body as string);
  }
  if (hasOwnItemCommentKey(patch, "anchor")) {
    Object.assign(changes, cleanItemCommentAnchor(patch.anchor));
  }
  if (Object.keys(changes).length === 0) {
    throw new Error("No comment changes provided");
  }
  const actor = cleanItemCommentActor(actorContext);
  const updated = await db
    .update(itemComments)
    .set({
      ...changes,
      editedByUserId: actor.actorUserId,
      editedByActorType: actor.actorType,
      updatedAt: new Date(),
    })
    .where(
      and(eq(itemComments.id, commentId), eq(itemComments.postId, itemId)),
    )
    .returning();
  if (!updated[0]) throw new Error("Comment not found");
  await recordAction({
    actorUserId: actor.actorUserId,
    actorType: actor.actorType,
    actionName: "update_item_comment",
    targetType: "item",
    targetId: itemId,
    inputSummary: commentId,
  });
  return mapItemComment(updated[0]);
}

export function setItemCommentResolved(
  input: SetItemCommentResolvedRequest,
): Promise<ItemComment>;
export function setItemCommentResolved(
  itemId: string,
  commentId: string,
  resolved: boolean,
  actorContext: ItemCommentActorContext,
): Promise<ItemComment>;
export async function setItemCommentResolved(
  inputOrItemId: string | SetItemCommentResolvedRequest,
  ...args: [string?, boolean?, ItemCommentActorContext?]
): Promise<ItemComment> {
  if (!db) throw new Error("setItemCommentResolved requires DATABASE_URL");
  const record =
    typeof inputOrItemId === "string"
      ? null
      : (inputOrItemId as unknown as Record<string, unknown>);
  const itemId =
    typeof inputOrItemId === "string"
      ? inputOrItemId
      : typeof inputOrItemId.itemId === "string" && inputOrItemId.itemId.trim()
        ? inputOrItemId.itemId
        : typeof record?.postId === "string"
          ? record.postId
          : "";
  const commentId =
    typeof inputOrItemId === "string"
      ? args[0]
      : typeof inputOrItemId.commentId === "string"
        ? inputOrItemId.commentId
        : typeof record?.id === "string"
          ? record.id
          : undefined;
  const resolved =
    typeof inputOrItemId === "string" ? args[1] : inputOrItemId.resolved;
  if (!itemId || !commentId || typeof resolved !== "boolean") {
    throw new Error("Comment item ID, comment ID, and resolved state are required");
  }
  const embeddedActor =
    typeof inputOrItemId === "object" &&
    "actor" in inputOrItemId &&
    inputOrItemId.actor &&
    typeof inputOrItemId.actor === "object"
      ? inputOrItemId.actor
      : null;
  const actorUserId =
    typeof record?.actorUserId === "string"
      ? record.actorUserId
      : typeof record?.resolvedByUserId === "string"
        ? record.resolvedByUserId
        : null;
  const actorType =
    record?.actorType === "ai" || record?.actorType === "external_agent"
      ? record.actorType
      : "human";
  const actor = cleanItemCommentActor(
    args[2] ?? embeddedActor ?? { actorUserId, actorType },
  );
  const now = new Date();
  const updated = await db
    .update(itemComments)
    .set({
      resolvedAt: resolved ? now : null,
      resolvedByUserId: resolved ? actor.actorUserId : null,
      resolvedByActorType: resolved ? actor.actorType : null,
      updatedAt: now,
    })
    .where(
      and(eq(itemComments.id, commentId), eq(itemComments.postId, itemId)),
    )
    .returning();
  if (!updated[0]) throw new Error("Comment not found");
  await recordAction({
    actorUserId: actor.actorUserId,
    actorType: actor.actorType,
    actionName: resolved ? "resolve_item_comment" : "reopen_item_comment",
    targetType: "item",
    targetId: itemId,
    inputSummary: commentId,
  });
  return mapItemComment(updated[0]);
}

export async function resolveItemComment(
  itemId: string,
  commentId: string,
  actorContext: ItemCommentActorContext,
): Promise<ItemComment> {
  return setItemCommentResolved(itemId, commentId, true, actorContext);
}

export async function reopenItemComment(
  itemId: string,
  commentId: string,
  actorContext: ItemCommentActorContext,
): Promise<ItemComment> {
  return setItemCommentResolved(itemId, commentId, false, actorContext);
}

/** Return the deleted row so the caller can audit its comment and item IDs. */
export async function deleteItemComment(
  itemId: string,
  commentId: string,
  actorContext: ItemCommentActorContext,
): Promise<ItemComment> {
  if (!db) throw new Error("deleteItemComment requires DATABASE_URL");
  const actor = cleanItemCommentActor(actorContext);
  const deleted = await db
    .delete(itemComments)
    .where(
      and(eq(itemComments.id, commentId), eq(itemComments.postId, itemId)),
    )
    .returning();
  if (!deleted[0]) throw new Error("Comment not found");
  await recordAction({
    actorUserId: actor.actorUserId,
    actorType: actor.actorType,
    actionName: "delete_item_comment",
    targetType: "item",
    targetId: itemId,
    inputSummary: commentId,
  });
  return mapItemComment(deleted[0]);
}

export async function deletePost(handle: string, id: string): Promise<void> {
  if (!db) throw new Error("deletePost requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  await db
    .update(posts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(posts.id, id),
        eq(posts.blogId, blogId),
        isNull(posts.deletedAt),
      ),
    );
}

/**
 * Delete a post for a sync client, guarding on the revision the client last saw.
 * The delete only lands if the row still carries `expectedRevision`, so an edit
 * that arrived after the client last read the file is never silently discarded
 * by a stale delete: the guarded UPDATE matches nothing and we raise a conflict.
 * A row that is already gone is treated as done (delete is idempotent). Done as
 * one guarded statement so the check and the delete cannot race.
 */
export async function deletePostAtomic(
  handle: string,
  id: string,
  expectedRevision: number,
  audit?: AuditEntry,
): Promise<void> {
  if (!db) throw new Error("deletePostAtomic requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  let deletedId: string | undefined;
  if (audit) {
    // Atomic: the soft-delete and its audit row commit in ONE neon-http
    // transaction, so a mutated post can never be left without provenance.
    const auditCte = auditCteFrom(audit, "changed", sql`changed.id::text`);
    const result = await db.execute(sql`
      WITH changed AS (
        UPDATE ${posts} SET deleted_at = now(), updated_at = now()
        WHERE id = ${id} AND blog_id = ${blogId}
          AND deleted_at IS NULL AND revision = ${expectedRevision}
        RETURNING id
      ), audit AS (${auditCte})
      SELECT id FROM changed
    `);
    deletedId = (result.rows[0] as { id?: string } | undefined)?.id;
  } else {
    const deleted = await db
      .update(posts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(posts.id, id),
          eq(posts.blogId, blogId),
          isNull(posts.deletedAt),
          eq(posts.revision, expectedRevision),
        ),
      )
      .returning({ id: posts.id });
    deletedId = deleted[0]?.id;
  }
  if (deletedId) return;
  // Nothing matched: either the post is already gone (idempotent success) or it
  // is still live at a newer revision (a concurrent edit) which must not be
  // silently deleted.
  const live = await db
    .select({ revision: posts.revision })
    .from(posts)
    .where(
      and(eq(posts.id, id), eq(posts.blogId, blogId), isNull(posts.deletedAt)),
    )
    .limit(1);
  if (live[0]) throw new PostConflictError();
}

// MARK: idempotent creates
//
// A sync create carries a client-generated Idempotency-Key so an ambiguous
// response (the create committed but the reply was lost) can be retried without
// duplicating the item. The caller claims the key first, does the create, then
// resolves the key with the created id; a retry sees the resolved key and
// returns the same item. Claiming is a single INSERT ... ON CONFLICT DO NOTHING,
// so even two concurrent retries with one key produce exactly one item.

export type IdempotencyClaim =
  | { status: "claimed" }
  | { status: "done"; kind: "post" | "folder"; id: string }
  | { status: "inflight" };

/** An unresolved claim older than this is treated as abandoned (its request
 * died before recording a result), so a retry can re-claim instead of being
 * locked out forever. Comfortably longer than any real create round-trip. */
const IDEMPOTENCY_CLAIM_STALE_MS = 30_000;

export async function claimIdempotencyKey(
  handle: string,
  key: string,
): Promise<IdempotencyClaim> {
  if (!db) return { status: "claimed" };
  const blogId = await blogIdFor(handle);
  const claimed = await db
    .insert(idempotencyKeys)
    .values({ blogId, key })
    .onConflictDoNothing({
      target: [idempotencyKeys.blogId, idempotencyKeys.key],
    })
    .returning({ key: idempotencyKeys.key });
  if (claimed[0]) return { status: "claimed" };
  // Already claimed by an earlier attempt: report its result, or that the first
  // attempt is still running (result not recorded yet).
  const existing = await db
    .select({
      resultKind: idempotencyKeys.resultKind,
      resultId: idempotencyKeys.resultId,
    })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.blogId, blogId), eq(idempotencyKeys.key, key)))
    .limit(1);
  const row = existing[0];
  if (
    row?.resultId &&
    (row.resultKind === "post" || row.resultKind === "folder")
  ) {
    return { status: "done", kind: row.resultKind, id: row.resultId };
  }
  // Unresolved. If the claiming request died (stale), reclaim it so a retry is
  // not locked out forever; the guarded delete + re-insert lets exactly one
  // racer win. Otherwise the first attempt is genuinely still in flight.
  const staleCutoff = new Date(Date.now() - IDEMPOTENCY_CLAIM_STALE_MS);
  const reclaimed = await db
    .delete(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.blogId, blogId),
        eq(idempotencyKeys.key, key),
        isNull(idempotencyKeys.resultId),
        lt(idempotencyKeys.createdAt, staleCutoff),
      ),
    )
    .returning({ key: idempotencyKeys.key });
  if (reclaimed[0]) {
    const retry = await db
      .insert(idempotencyKeys)
      .values({ blogId, key })
      .onConflictDoNothing({
        target: [idempotencyKeys.blogId, idempotencyKeys.key],
      })
      .returning({ key: idempotencyKeys.key });
    if (retry[0]) return { status: "claimed" };
  }
  return { status: "inflight" };
}

export async function resolveIdempotencyKey(
  handle: string,
  key: string,
  kind: "post" | "folder",
  id: string,
): Promise<void> {
  if (!db) return;
  const blogId = await blogIdFor(handle);
  await db
    .update(idempotencyKeys)
    .set({ resultKind: kind, resultId: id })
    .where(and(eq(idempotencyKeys.blogId, blogId), eq(idempotencyKeys.key, key)));
}

/** Release a claim whose create ultimately failed, so a retry can start fresh
 * rather than be told a nonexistent item was created. Only unresolved claims
 * are released; a resolved key is permanent. */
export async function releaseIdempotencyKey(
  handle: string,
  key: string,
): Promise<void> {
  if (!db) return;
  const blogId = await blogIdFor(handle);
  await db
    .delete(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.blogId, blogId),
        eq(idempotencyKeys.key, key),
        isNull(idempotencyKeys.resultId),
      ),
    );
}

export async function getTrashedPosts(handle: string): Promise<Post[]> {
  if (!db) return [];
  const rows = await db
    .select({ post: posts })
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      and(
        eq(blogs.handle, handle),
        isNull(blogs.deletedAt),
        isNotNull(posts.deletedAt),
      ),
    )
    .orderBy(desc(posts.deletedAt), desc(posts.updatedAt));
  return rows.map((row) => mapPost(row.post));
}

export async function getTrashedFolders(handle: string): Promise<Folder[]> {
  if (!db) return [];
  const blogId = await blogIdFor(handle);
  const rows = await db
    .select()
    .from(folders)
    .where(and(eq(folders.blogId, blogId), isNotNull(folders.deletedAt)))
    .orderBy(desc(folders.deletedAt), asc(folders.position));
  return rows.map(mapFolder);
}

export async function restorePost(handle: string, id: string): Promise<Post> {
  if (!db) throw new Error("restorePost requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  const updated = await db
    .update(posts)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(posts.id, id),
        eq(posts.blogId, blogId),
        isNotNull(posts.deletedAt),
      ),
    )
    .returning();
  if (!updated[0]) throw new Error("Item not found in Trash");
  return mapPost(updated[0]);
}

async function deleteCollabDataForPostIds(ids: string[]): Promise<void> {
  if (!db) return;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await db.delete(collabPresence).where(inArray(collabPresence.postId, chunk));
    await db.delete(collabUpdates).where(inArray(collabUpdates.postId, chunk));
    // collab_state has its own post foreign key. It must be removed too, or a
    // post that has ever joined a collab epoch cannot be permanently deleted.
    await db.delete(collabState).where(inArray(collabState.postId, chunk));
  }
}

export async function permanentlyDeletePost(
  handle: string,
  id: string,
): Promise<void> {
  if (!db) throw new Error("permanentlyDeletePost requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  const target = await db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.id, id),
        eq(posts.blogId, blogId),
        isNotNull(posts.deletedAt),
      ),
    )
    .limit(1);
  if (!target[0]) return;
  // Scope the post before touching its dependent rows. Deleting collab rows by
  // the caller-provided id first would let a valid owner disrupt another
  // tenant's active document by submitting its opaque id.
  await deleteCollabDataForPostIds([id]);
  await db
    .delete(posts)
    .where(
      and(
        eq(posts.id, id),
        eq(posts.blogId, blogId),
        isNotNull(posts.deletedAt),
      ),
    );
}

export async function emptyTrash(handle: string): Promise<number> {
  if (!db) throw new Error("emptyTrash requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  const trashed = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.blogId, blogId), isNotNull(posts.deletedAt)));
  const ids = trashed.map((row) => row.id);
  await deleteCollabDataForPostIds(ids);
  await db
    .delete(posts)
    .where(and(eq(posts.blogId, blogId), isNotNull(posts.deletedAt)));
  await db
    .delete(folders)
    .where(and(eq(folders.blogId, blogId), isNotNull(folders.deletedAt)));
  return ids.length;
}

export async function trashFolder(
  handle: string,
  folderId: string,
): Promise<void> {
  if (!db) throw new Error("trashFolder requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  const target = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.id, folderId),
        eq(folders.blogId, blogId),
        isNull(folders.deletedAt),
      ),
    )
    .limit(1);
  const folder = target[0];
  if (!folder) throw new Error("Folder not found");
  const descendants = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.blogId, blogId),
        isNull(folders.deletedAt),
        or(eq(folders.path, folder.path), like(folders.path, `${folder.path}/%`)),
      ),
    );
  const ids = descendants.map((entry) => entry.id);
  const now = new Date();
  if (ids.length > 0) {
    await db
      .update(posts)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(posts.blogId, blogId),
          inArray(posts.folderId, ids),
          isNull(posts.deletedAt),
        ),
      );
    await db
      .update(folders)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(folders.blogId, blogId), inArray(folders.id, ids)));
  }
}

export async function restoreFolder(
  handle: string,
  folderId: string,
): Promise<void> {
  if (!db) throw new Error("restoreFolder requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  const target = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.id, folderId),
        eq(folders.blogId, blogId),
        isNotNull(folders.deletedAt),
      ),
    )
    .limit(1);
  const folder = target[0];
  if (!folder) throw new Error("Folder not found in Trash");
  const deletionTime = folder.deletedAt;
  if (!deletionTime) throw new Error("Folder not found in Trash");
  const descendants = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.blogId, blogId),
        eq(folders.deletedAt, deletionTime),
        or(eq(folders.path, folder.path), like(folders.path, `${folder.path}/%`)),
      ),
    );
  const ids = descendants.map((entry) => entry.id);
  if (ids.length > 0) {
    const now = new Date();
    await db
      .update(folders)
      .set({ deletedAt: null, updatedAt: now })
      .where(and(eq(folders.blogId, blogId), inArray(folders.id, ids)));
    await db
      .update(posts)
      .set({ deletedAt: null, updatedAt: now })
      .where(
        and(
          eq(posts.blogId, blogId),
          inArray(posts.folderId, ids),
          eq(posts.deletedAt, deletionTime),
        ),
      );
  }
}

export async function permanentlyDeleteFolder(
  handle: string,
  folderId: string,
): Promise<void> {
  if (!db) throw new Error("permanentlyDeleteFolder requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  const target = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.id, folderId),
        eq(folders.blogId, blogId),
        isNotNull(folders.deletedAt),
      ),
    )
    .limit(1);
  const folder = target[0];
  if (!folder) return;
  const descendants = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.blogId, blogId),
        isNotNull(folders.deletedAt),
        or(eq(folders.path, folder.path), like(folders.path, `${folder.path}/%`)),
      ),
    );
  const ids = descendants.map((entry) => entry.id);
  if (ids.length === 0) return;
  const folderPosts = await db
    .select({ id: posts.id, deletedAt: posts.deletedAt })
    .from(posts)
    .where(and(eq(posts.blogId, blogId), inArray(posts.folderId, ids)));
  // A live item must never be collateral damage of purging a trashed folder.
  // This is normally prevented by the Trash UI, but the store still fails safe
  // against a restore race or a direct caller that revived a child first.
  if (folderPosts.some((post) => post.deletedAt === null)) {
    throw new Error("The folder contains a restored item and cannot be deleted");
  }
  await deleteCollabDataForPostIds(folderPosts.map((post) => post.id));
  await db
    .delete(posts)
    .where(
      and(
        eq(posts.blogId, blogId),
        inArray(posts.folderId, ids),
        isNotNull(posts.deletedAt),
      ),
    );
  await db.delete(folders).where(and(eq(folders.blogId, blogId), inArray(folders.id, ids)));
}

export async function trashBlogPosts(handle: string): Promise<void> {
  if (!db) throw new Error("trashBlogPosts requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  await db
    .update(posts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(posts.blogId, blogId), isNull(posts.deletedAt)));
}

export async function setPostPinned(
  handle: string,
  id: string,
  pinned: boolean,
): Promise<Post> {
  if (!db) throw new Error("setPostPinned requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  const updated = await db
    .update(posts)
    // Bump updatedAt so a pin/unpin advances the workspace change cursor and
    // reaches sync clients instantly, not only on the 60s fallback pass.
    .set({ pinned, updatedAt: new Date() })
    .where(
      and(
        eq(posts.id, id),
        eq(posts.blogId, blogId),
        isNull(posts.deletedAt),
      ),
    )
    .returning();
  if (!updated[0]) throw new Error("Post not found");
  return mapPost(updated[0]);
}

export async function setPostStarred(
  handle: string,
  id: string,
  starred: boolean,
): Promise<Post> {
  if (!db) throw new Error("setPostStarred requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  const updated = await db
    .update(posts)
    // Personal stars participate in sync and the local-first pool, so they
    // advance the same mutation cursor as every other post change.
    .set({ starred, updatedAt: new Date() })
    .where(
      and(
        eq(posts.id, id),
        eq(posts.blogId, blogId),
        isNull(posts.deletedAt),
      ),
    )
    .returning();
  if (!updated[0]) throw new Error("Post not found");
  return mapPost(updated[0]);
}

export async function setPostCreatedAt(
  handle: string,
  id: string,
  createdAt: Date,
): Promise<Post> {
  if (!db) throw new Error("setPostCreatedAt requires DATABASE_URL");
  if (!Number.isFinite(createdAt.getTime())) throw new Error("Choose a valid date");
  const blogId = await blogIdFor(handle);
  const updated = await db
    .update(posts)
    .set({ createdAt, updatedAt: new Date() })
    .where(
      and(
        eq(posts.id, id),
        eq(posts.blogId, blogId),
        isNull(posts.deletedAt),
      ),
    )
    .returning();
  if (!updated[0]) throw new Error("Post not found");
  return mapPost(updated[0]);
}

function isPostsSlugConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
    detail?: unknown;
  };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const constraint =
    typeof candidate.constraint === "string" ? candidate.constraint : "";
  const message =
    typeof candidate.message === "string" ? candidate.message : "";
  const detail = typeof candidate.detail === "string" ? candidate.detail : "";
  if (
    constraint === "posts_folder_slug_idx" ||
    constraint === "posts_blog_slug_idx" ||
    constraint === "public_url_tombstones_blog_path_idx"
  ) {
    return true;
  }
  return (
    code === "23505" &&
    /(?:posts_(?:folder|blog)_slug_idx|public_url_tombstones_blog_path_idx)/.test(
      message + detail,
    )
  );
}

async function assertPublicPathAvailable(
  blogId: string,
  folderPath: string,
  slug: string,
  postId?: string,
): Promise<void> {
  const [reserved] = await db!
    .select({ postId: publicUrlTombstones.postId })
    .from(publicUrlTombstones)
    .where(
      and(
        eq(publicUrlTombstones.blogId, blogId),
        eq(publicUrlTombstones.path, publicPathFor(folderPath, slug)),
      ),
    )
    .limit(1);
  if (reserved && reserved.postId !== postId) {
    throw new Error("That URL is already used");
  }
}

export type PostContentPatch = Partial<
  Pick<
    Post,
    "title" | "body" | "cover" | "coverCaption" | "coverHeight" | "tags"
  >
> & {
  /**
   * Collaborators may replace structured content, never presentation. The
   * helper below enforces that boundary even when a package carries both.
   */
  document?: DocumentSnapshot;
};

function hasOwnContentKey<K extends keyof PostContentPatch>(
  patch: PostContentPatch,
  key: K,
): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

// Persist the editor's draft.
// Updates the row by id, scoped to this blog so a stale or foreign id can never
// touch another tenant, so a slug edit renames in place; otherwise inserts,
// upserting on the (blog, slug) unique index. For a published post, published_at
// follows the editor's Date field (or is stamped now on first publish); a draft
// leaves any existing published_at untouched, so unpublish then republish keeps
// the original date.
/**
 * Thrown by a guarded save (`expectedUpdatedAt`) when the row moved out from
 * under the caller: the base version no longer matches, or the row was deleted.
 * The sync PUT route maps this to 412, so the client refetches and merges rather
 * than silently losing the concurrent write.
 */
export class PostConflictError extends Error {
  constructor() {
    super("The post changed since it was fetched");
    this.name = "PostConflictError";
  }
}

type SavePostOptions = {
  preservePublishedAt?: boolean;
  /**
   * Optimistic-lock token: the `revision` the caller's edit is based on. When
   * set, the UPDATE only lands if the row still carries that exact revision, and
   * a zero-row result throws `PostConflictError` instead of falling through to
   * an insert. This makes a check-then-write a true compare-and-swap: every
   * mutation assigns a fresh `nextval('texttext_change_seq')`, so a concurrent
   * writer that commits first changes the revision (even within the same
   * millisecond) and the second save conflicts instead of clobbering it. A
   * stale save can likewise never resurrect a deleted post.
   */
  expectedRevision?: number;
  audit?: AuditEntry;
  /**
   * Custom field values to merge into the canonical document's content.fields,
   * applied on top of whatever base canonicalDocumentForSave derives (the
   * supplied document, the existing row, or the legacy projection). A null
   * clears a key. This is how an agent's update_item writes field values
   * without needing the full document loaded client-side.
   */
  fieldsPatch?: Record<string, DocumentFieldValue | null>;
};

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalDocumentForSave(
  post: Post,
  existingRow?: PostRow,
  fieldsPatch?: Record<string, DocumentFieldValue | null>,
): DocumentSnapshot {
  const current = existingRow ? mapPost(existingRow) : null;
  const suppliedDocument = post.document
    ? validateDocumentSnapshot(post.document)
    : null;
  const base =
    suppliedDocument ??
    current?.document ??
    documentFromLegacyPost(post);
  const fields = { ...base.content.fields };
  if (fieldsPatch) {
    for (const [key, value] of Object.entries(fieldsPatch)) {
      if (value === null) delete fields[key];
      else fields[key] = documentFieldValueSchema.parse(value);
    }
  }

  const legacyChanged = <K extends keyof Post>(key: K): boolean => {
    if (!current) return !suppliedDocument;
    return !valuesEqual(post[key], current[key]);
  };
  const setField = (key: string, value: unknown): void => {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null ||
      (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
    ) {
      fields[key] = value;
    } else {
      delete fields[key];
    }
  };

  if (legacyChanged("cover")) setField("cover", post.cover);
  if (legacyChanged("coverCaption")) {
    setField("coverCaption", post.coverCaption);
  }
  if (legacyChanged("coverHeight")) {
    setField("coverHeight", post.coverHeight);
  }
  if (legacyChanged("videoUrl")) setField("videoUrl", post.videoUrl);
  if (legacyChanged("venue")) setField("venue", post.venue);
  if (legacyChanged("duration")) setField("duration", post.duration);
  if (legacyChanged("links")) {
    setField("sourceUrl", post.links?.[0]?.href);
    setField("sourceLabel", post.links?.[0]?.label);
  }

  let template = base.presentation.template;
  if (
    post.template &&
    (!current || !valuesEqual(post.template, current.template))
  ) {
    template = post.template;
  }

  const theme = { ...base.presentation.theme };
  if (legacyChanged("accent")) {
    if (post.accent && /^#[0-9a-fA-F]{6}$/.test(post.accent)) {
      theme.accent = post.accent;
    } else {
      delete theme.accent;
    }
  }

  return validateDocumentSnapshot({
    ...base,
    content: {
      ...base.content,
      title: legacyChanged("title") ? post.title : base.content.title,
      subtitle: legacyChanged("excerpt")
        ? post.excerpt || undefined
        : base.content.subtitle,
      body: legacyChanged("body") ? post.body : base.content.body,
      fields,
      tags: legacyChanged("tags")
        ? normalizeTags(post.tags)
        : base.content.tags,
      assets: legacyChanged("gallery")
        ? (post.gallery ?? []).map((asset, index) => ({
            id: `gallery-${index + 1}`,
            kind: /\.(?:mp4|webm|mov|m4v|ogv|ogg)(?:[?#].*)?$/i.test(
              asset.src,
            )
              ? ("video" as const)
              : ("image" as const),
            src: asset.src,
            caption: asset.caption,
          }))
        : base.content.assets,
    },
    presentation: {
      ...base.presentation,
      template,
      theme,
    },
  });
}

function visibilityForSave(post: Post, existingRow?: PostRow): DocumentVisibility {
  return resolveDocumentVisibility({
    requested: post.visibility,
    existing: existingRow?.visibility,
    compatibilityType: existingRow?.type ?? post.type,
  });
}

async function recordPostSave(
  saved: Post,
  audit: AuditEntry | undefined,
): Promise<Post> {
  if (!saved.id) return saved;
  await recordAction(
    audit ?? {
      actorType: "human",
      actionName: "save_document",
      targetType: "item",
      targetId: saved.id,
      inputSummary: saved.slug,
    },
  );
  return saved;
}

export async function savePost(
  handle: string,
  post: Post,
  options: SavePostOptions = {},
): Promise<Post> {
  if (!db) throw new Error("savePost requires DATABASE_URL");
  if (options.preservePublishedAt && !post.id) {
    throw new Error("Cannot preserve published_at without an existing post");
  }
  const blogId = await blogIdFor(handle);
  const slug = sanitizePostSlug(post.slug, "post");
  const existingRow = post.id
    ? (
        await db
          .select()
          .from(posts)
          .where(
            and(
              eq(posts.id, post.id),
              eq(posts.blogId, blogId),
              isNull(posts.deletedAt),
            ),
          )
          .limit(1)
      )[0]
    : undefined;
  const document = canonicalDocumentForSave(post, existingRow, options.fieldsPatch);
  const projection = legacyProjectionFromDocument(document);
  const visibility = visibilityForSave(post, existingRow);
  const compatibilityType = existingRow?.type ?? post.type;
  const status: Post["status"] =
    visibility === "public" ? "published" : "draft";
  const wordCount = wordCountForMarkdown(document.content.body);
  // Existing rows keep their folder. New documents use the folder selected by
  // the caller when available, then the template's legacy compatibility root.
  const insertFolder = post.folderId
    ? await getFolderById(handle, post.folderId)
    : await folderForPostType(blogId, compatibilityType);
  if (!insertFolder) throw new Error("Folder not found");
  const saveFolder = existingRow?.folderId
    ? await getFolderById(handle, existingRow.folderId)
    : insertFolder;
  if (!saveFolder) throw new Error("Folder not found");
  if (status === "published") {
    await assertPublicPathAvailable(blogId, saveFolder.path, slug, post.id);
  }
  const base = {
    document,
    visibility,
    templateId: document.presentation.template.id,
    templateVersion: document.presentation.template.version,
    type: compatibilityType,
    title: projection.title,
    excerpt: projection.excerpt || null,
    accent: projection.accent,
    cover: projection.cover,
    coverCaption: projection.coverCaption,
    coverHeight: projection.coverHeight,
    gallery: projection.gallery,
    links: projection.links,
    tags: projection.tags,
    videoUrl: projection.videoUrl,
    venue: projection.venue,
    duration: projection.duration,
    body: projection.body,
    wordCount,
    status,
    pinned: post.pinned ?? false,
    starred: post.starred ?? false,
    updatedAt: new Date(),
    // revision is assigned by the posts_bump_revision trigger (updates) and the
    // column default (inserts); no mutation path has to remember to bump it.
  };
  const publishedAt =
    options.preservePublishedAt || status !== "published"
      ? undefined
      : post.date
        ? new Date(post.date)
        : sql`COALESCE(${posts.publishedAt}, now())`;
  // Draft and preserve-mode saves omit published_at from the update.
  const set = publishedAt === undefined ? base : { ...base, publishedAt };

  try {
    if (post.id) {
      // Optional compare-and-swap: the guard only lets the UPDATE land if the
      // row still carries the exact revision the caller fetched. Every mutation
      // assigns a fresh nextval, so a concurrent writer that committed first
      // changed the revision and this save then matches zero rows.
      const guard =
        options.expectedRevision !== undefined
          ? [eq(posts.revision, options.expectedRevision)]
          : [];
      const updated = await db
        .update(posts)
        .set({ ...set, slug })
        .where(
          and(
            eq(posts.id, post.id),
            eq(posts.blogId, blogId),
            isNull(posts.deletedAt),
            ...guard,
          ),
        )
        .returning();
      if (updated[0]) {
        return recordPostSave(mapPost(updated[0]), options.audit);
      }
      // A guarded save that matched nothing is a conflict, never an insert:
      // the base moved (someone else wrote) or the row is gone (deleted). Both
      // must surface as 412, not silently resurrect the post or upsert onto
      // whatever row happens to share this slug.
      if (options.expectedRevision !== undefined) throw new PostConflictError();
      if (options.preservePublishedAt) throw new Error("Post not found");
    }

    const inserted = await db
      .insert(posts)
      .values({
        blogId,
        folderId: insertFolder.id,
        representation: post.representation ?? DEFAULT_FILE_REPRESENTATION,
        slug,
        ...base,
        publishedAt:
          status === "published"
            ? post.date
              ? new Date(post.date)
              : new Date()
            : null,
      })
      // The unique index is partial (deleted_at is null), so the conflict
      // target must match it; trashed rows never absorb a new post's save.
      .onConflictDoUpdate({
        target: [posts.folderId, posts.slug],
        targetWhere: sql`${posts.deletedAt} is null`,
        set,
      })
      .returning();
    return recordPostSave(mapPost(inserted[0]), options.audit);
  } catch (error) {
    if (isPostsSlugConflict(error)) throw new Error("That URL is already used");
    throw error;
  }
}

export async function savePostContentPatch(
  handle: string,
  existing: Post,
  patch: PostContentPatch,
  options: { expectedRevision?: number; audit?: AuditEntry } = {},
): Promise<Post> {
  const next: Post = {
    ...existing,
    type: existing.type,
    slug: existing.slug,
    status: existing.status,
    pinned: existing.pinned,
    starred: existing.starred,
    folderId: existing.folderId,
    date: existing.date,
  };

  if (patch.document) {
    const currentDocument = requireDocumentSnapshot(
      existing.document,
      `Persisted item ${existing.id ?? existing.slug}`,
    );
    const suppliedDocument = validateDocumentSnapshot(patch.document);
    next.document = validateDocumentSnapshot({
      ...currentDocument,
      content: suppliedDocument.content,
    });
    Object.assign(next, legacyProjectionFromDocument(next.document));
  }

  if (hasOwnContentKey(patch, "title") && patch.title !== undefined) {
    next.title = patch.title;
  }
  if (hasOwnContentKey(patch, "body") && patch.body !== undefined) {
    next.body = patch.body;
  }
  if (hasOwnContentKey(patch, "cover")) {
    next.cover = patch.cover;
  }
  if (hasOwnContentKey(patch, "coverCaption")) {
    next.coverCaption = patch.coverCaption;
  }
  if (hasOwnContentKey(patch, "coverHeight")) {
    next.coverHeight = patch.coverHeight;
  }
  if (hasOwnContentKey(patch, "tags")) {
    next.tags = normalizeTags(patch.tags);
  }

  return savePost(handle, next, {
    preservePublishedAt: true,
    expectedRevision: options.expectedRevision,
    audit: options.audit,
  });
}

// Create an empty draft and return it (with its new id), for the editor's
// "New draft" action. Requires a database. The draft lands in the system
// folder matching its type: note -> notes, bookmark -> bookmarks, else blog.
export async function createDraft(
  handle: string,
  type: PostType = "article",
  options: CreateDraftOptions = {},
): Promise<Post> {
  if (!db) throw new Error("createDraft requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  const folder = await folderForPostType(blogId, type);
  const template =
    options.template ??
    folder.defaultTemplate ?? { id: legacyTemplateId(type), version: 1 };
  const document = emptyDocumentSnapshot(template);
  const slug = `untitled-${Date.now().toString(36)}`;
  const inserted = await db
    .insert(posts)
    .values({
      blogId,
      folderId: folder.id,
      representation:
        options.representation ?? DEFAULT_FILE_REPRESENTATION,
      document,
      visibility: "private",
      templateId: template.id,
      templateVersion: template.version,
      type,
      slug,
      title: "",
      excerpt: "",
      body: "",
      wordCount: 0,
      status: "draft",
    })
    .returning();
  const created = mapPost(inserted[0]);
  await recordAction(
    options.audit ?? {
      actorType: "human",
      actionName: "create_document",
      targetType: "item",
      targetId: created.id,
      outputSummary: `${template.id}@${template.version}`,
    },
  );
  return created;
}

function slugifyHandle(value: string, maxLength = 24, fallback = "blog"): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || fallback;
}

// A blog handle not already taken and not reserved, derived from a seed.
async function uniqueHandle(seed: string): Promise<string> {
  const base = slugifyHandle(seed);
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (RESERVED_HANDLES.has(candidate)) continue;
    const taken = await db!
      .select({ id: blogs.id })
      .from(blogs)
      .where(eq(blogs.handle, candidate))
      .limit(1);
    // A deleted account's handle stays held. Other people linked to
    // /t/<handle>, and handing it to the next signup would quietly point their
    // readers at a stranger.
    const held = await db!
      .select({ id: deletedAccounts.id })
      .from(deletedAccounts)
      .where(eq(deletedAccounts.handle, candidate))
      .limit(1);
    if (!taken[0] && !held[0]) return candidate;
  }
  // Fallback: keep it inside the 32-char tenant-handle limit (tenants.ts regex).
  const suffix = Date.now().toString(36);
  const short = base.slice(0, 30 - suffix.length).replace(/-+$/, "") || "blog";
  return `${short}-${suffix}`;
}

// The blog owned by the user with this Apple sub, or null.
export async function getOwnedBlog(sub: string): Promise<Blog | null> {
  if (!db) return null;
  const rows = await db
    .select({
      handle: blogs.handle,
      username: users.username,
      name: blogs.name,
      tagline: blogs.tagline,
      accent: blogs.accent,
      bioLine: blogs.bioLine,
      cardStyle: blogs.cardStyle,
      homeLayout: blogs.homeLayout,
      author: users.name,
    })
    .from(blogs)
    .leftJoin(users, eq(blogs.ownerId, users.id))
    .where(and(eq(users.appleSub, sub), isNull(blogs.deletedAt)))
    .orderBy(asc(blogs.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return mapBlog(row);
}

// The users row id for an Apple sub (api_tokens hangs off users.id), or null.
/**
 * The person a session's subject belongs to.
 *
 * Identities first, because that table is the one that can hold more than one
 * way in. users.appleSub is still consulted as a fallback so a session minted
 * before the identities backfill keeps working; every row is backfilled, so in
 * practice this second query only runs for a subject that belongs to nobody.
 */
export async function getUserIdBySub(sub: string): Promise<string | null> {
  if (!db) return null;
  const linked = await db
    .select({ id: userIdentities.userId })
    .from(userIdentities)
    .where(eq(userIdentities.subject, sub))
    .limit(1);
  if (linked[0]) return linked[0].id;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.appleSub, sub))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Which providers this person can sign in with, for the settings UI. */
export async function listUserIdentities(
  userId: string,
): Promise<{ provider: string; createdAt: Date }[]> {
  if (!db) return [];
  return db
    .select({
      provider: userIdentities.provider,
      createdAt: userIdentities.createdAt,
    })
    .from(userIdentities)
    .where(eq(userIdentities.userId, userId));
}

export function providerForSubject(sub: string, userId: string): string {
  if (sub.startsWith("google:")) return "google";
  if (sub === userId) return "email";
  return "apple";
}

/**
 * Attaches a way of signing in to an existing person.
 *
 * Returns "linked" when it is now theirs, "already-yours" when it already was,
 * and "taken" when that subject belongs to somebody else. Taken must never
 * become a silent move: a subject reaching two accounts is the bug this table
 * exists to make impossible.
 */
export async function linkIdentityToUser(
  userId: string,
  sub: string,
): Promise<"linked" | "already-yours" | "taken"> {
  if (!db) throw new Error("linkIdentityToUser requires DATABASE_URL");
  const existing = await db
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(eq(userIdentities.subject, sub))
    .limit(1);
  if (existing[0]) {
    return existing[0].userId === userId ? "already-yours" : "taken";
  }
  await db.insert(userIdentities).values({
    userId,
    provider: providerForSubject(sub, userId),
    subject: sub,
  });
  return "linked";
}

async function upsertUser(
  user: StoreUser,
): Promise<{ id: string; name: string | null; username: string | null }> {
  // The resurrection fence. Sessions are JWTs with no server-side session
  // table, so a cookie minted before a deletion still verifies afterwards, and
  // this onConflictDoUpdate would insert the users row straight back on the
  // next authenticated request. Signing in again on purpose clears the
  // tombstone first (src/auth.ts); anything else stops here.
  if (await findAccountTombstone(user.sub)) {
    throw new AccountDeletedError();
  }

  // An identity already pointing at somebody means this subject is theirs, and
  // the users row below must not be touched: the insert would be a no-op but
  // the onConflictDoUpdate would rewrite another person's name and email from
  // whatever profile just signed in.
  const linked = await db!
    .select({ id: userIdentities.userId })
    .from(userIdentities)
    .where(eq(userIdentities.subject, user.sub))
    .limit(1);
  if (linked[0]) {
    const owner = (
      await db!
        .select({ id: users.id, name: users.name, username: users.username })
        .from(users)
        .where(eq(users.id, linked[0].id))
        .limit(1)
    )[0];
    if (owner) return owner;
  }

  await db!
    .insert(users)
    .values({
      appleSub: user.sub,
      name: user.name ?? null,
      email: user.email ?? null,
    })
    .onConflictDoUpdate({
      target: users.appleSub,
      set: {
        name: user.name ?? sql`${users.name}`,
        email: user.email ?? sql`${users.email}`,
      },
    });

  const row = (
    await db!
      .select({ id: users.id, name: users.name, username: users.username })
      .from(users)
      .where(eq(users.appleSub, user.sub))
      .limit(1)
  )[0];
  if (!row) throw new Error("failed to resolve user");

  // Record how they got in. Without this a brand new account would have no
  // identity row and would depend on the appleSub fallback forever, which is
  // the thing this table exists to retire.
  await db!
    .insert(userIdentities)
    .values({
      userId: row.id,
      provider: providerForSubject(user.sub, row.id),
      subject: user.sub,
    })
    .onConflictDoNothing();

  return row;
}

function usernameSeedForUser(user: StoreUser, fallback: string): string {
  return user.email?.split("@")[0] || user.name || fallback;
}

function usernameBase(seed: string): string {
  let base = slugifyUsername(seed, "writer");
  if (base.length < 3) base = `${base}-writer`;
  if (RESERVED_USERNAMES.has(base)) base = `${base}-writer`;
  return cleanUsername(base);
}

async function uniqueUsername(seed: string, ownerId: string): Promise<string> {
  const base = usernameBase(seed);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (!USERNAME_RE.test(candidate) || RESERVED_USERNAMES.has(candidate)) {
      continue;
    }
    const taken = await db!
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, candidate), ne(users.id, ownerId)))
      .limit(1);
    // Held for the same reason as a handle: /@username is an address other
    // people have linked to.
    const held = await db!
      .select({ id: deletedAccounts.id })
      .from(deletedAccounts)
      .where(eq(deletedAccounts.username, candidate))
      .limit(1);
    if (!taken[0] && !held[0]) return candidate;
  }

  const suffix = Date.now().toString(36);
  return cleanUsername(`writer-${suffix}`);
}

async function ensureUserUsername(
  owner: { id: string; username: string | null },
  seed: string,
): Promise<string> {
  if (owner.username) return owner.username;
  const username = await uniqueUsername(seed, owner.id);
  await db!
    .update(users)
    .set({ username })
    .where(eq(users.id, owner.id));
  owner.username = username;
  return username;
}

function hasPatchKey(
  patch: Record<string, unknown>,
  key: keyof BlogPatch,
): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function cleanRequiredLine(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) throw new Error(`${label} is required`);
  return cleaned;
}

function cleanOptionalLine(value: unknown, label: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  return value.trim().replace(/\s+/g, " ") || null;
}

function cleanBlogHandle(value: unknown): string {
  const raw = cleanRequiredLine(value, "Handle");
  const handle = slugifyHandle(raw, 32, "");
  if (!handle) throw new Error("Enter a handle");
  if (!TENANT_HANDLE_RE.test(handle)) {
    throw new Error("Use 1 to 32 letters, numbers, or hyphens");
  }
  if (RESERVED_HANDLES.has(handle)) throw new Error("That handle is reserved");
  return handle;
}

function cleanBlogAccent(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new Error("Accent must be a hex color");
  }
  const accent = value.trim();
  if (!accent) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) {
    throw new Error("Accent must be a hex color like #065ec6");
  }
  return accent;
}

function cleanStoredCardStyle(value: unknown): BlogCardStyle {
  return value === "minimal" ? "minimal" : DEFAULT_CARD_STYLE;
}

function cleanStoredHomeLayout(value: unknown): BlogHomeView {
  if (value === "list" || value === "column" || value === "grid") return value;
  // Rows written before Home owned this field held a page layout. The
  // migration converts them; this keeps a straggler readable.
  if (value === "single") return "column";
  return DEFAULT_HOME_LAYOUT;
}

function cleanBlogCardStyle(value: unknown): BlogCardStyle {
  if (value === "cover" || value === "minimal") return value;
  throw new Error("Card style must be Cover or Minimal");
}

function cleanBlogHomeLayout(value: unknown): BlogHomeView {
  if (value === "list" || value === "column" || value === "grid") return value;
  throw new Error("Home layout must be List, One column, or Cards");
}

function isBlogsHandleConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
    detail?: unknown;
  };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const constraint =
    typeof candidate.constraint === "string" ? candidate.constraint : "";
  const message =
    typeof candidate.message === "string" ? candidate.message : "";
  const detail = typeof candidate.detail === "string" ? candidate.detail : "";
  if (constraint === "blogs_handle_idx") return true;
  return code === "23505" && (message + detail).includes("blogs_handle_idx");
}

export async function signalWorkspaceChange(handle: string): Promise<void> {
  if (!db) throw new Error("signalWorkspaceChange requires DATABASE_URL");
  const [updated] = await db
    .update(blogs)
    .set({ changeSeq: sql`nextval('texttext_change_seq')` })
    .where(and(eq(blogs.handle, handle), isNull(blogs.deletedAt)))
    .returning({ id: blogs.id });
  if (!updated) throw new Error("Workspace not found");
}

export async function updateBlogByHandle(
  handle: string,
  patch: BlogPatch,
  options: { allowHandleChange?: boolean } = {},
): Promise<Blog> {
  if (!db) throw new Error("updateBlog requires DATABASE_URL");
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Invalid blog settings");
  }

  const input = patch as Record<string, unknown>;
  const existing = (
    await db
      .select({
        id: blogs.id,
        handle: blogs.handle,
        ownerId: blogs.ownerId,
        username: users.username,
        name: blogs.name,
        tagline: blogs.tagline,
        accent: blogs.accent,
        bioLine: blogs.bioLine,
        cardStyle: blogs.cardStyle,
        homeLayout: blogs.homeLayout,
        author: users.name,
      })
      .from(blogs)
      .leftJoin(users, eq(blogs.ownerId, users.id))
      .where(and(eq(blogs.handle, handle), isNull(blogs.deletedAt)))
      .orderBy(asc(blogs.createdAt))
      .limit(1)
  )[0];
  if (!existing) throw new Error("Blog not found");

  const set: Partial<typeof blogs.$inferInsert> = {};
  let nextUsername: string | undefined;

  if (hasPatchKey(input, "name")) {
    set.name = cleanRequiredLine(input.name, "Blog name");
  }
  if (hasPatchKey(input, "tagline")) {
    set.tagline = cleanOptionalLine(input.tagline, "Tagline");
  }
  if (hasPatchKey(input, "bioLine")) {
    set.bioLine = cleanOptionalLine(input.bioLine, "Bio line");
  }
  if (hasPatchKey(input, "accent")) {
    set.accent = cleanBlogAccent(input.accent);
  }
  if (hasPatchKey(input, "cardStyle")) {
    set.cardStyle = cleanBlogCardStyle(input.cardStyle);
  }
  if (hasPatchKey(input, "homeLayout")) {
    set.homeLayout = cleanBlogHomeLayout(input.homeLayout);
  }
  if (hasPatchKey(input, "username")) {
    if (!existing.ownerId) {
      throw new Error("Claim the blog before changing its username");
    }
    const username = cleanUsername(input.username);
    if (username !== existing.username) {
      const taken = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.username, username), ne(users.id, existing.ownerId)))
        .limit(1);
      if (taken[0]) throw new Error("That username is taken");
      // Validated here, written only after the blogs update succeeds, so a
      // failed blog patch never leaves a half-applied rename (no transactions
      // on the Neon HTTP driver).
      nextUsername = username;
    }
  }
  if (hasPatchKey(input, "handle")) {
    if (!options.allowHandleChange) {
      throw new Error("Claim the blog before changing its URL");
    }
    const handle = cleanBlogHandle(input.handle);
    if (handle !== existing.handle) {
      const taken = await db
        .select({ id: blogs.id })
        .from(blogs)
        .where(and(eq(blogs.handle, handle), ne(blogs.id, existing.id)))
        .limit(1);
      if (taken[0]) throw new Error("That handle is taken");
      set.handle = handle;
    }
  }

  const applyUsername = async (): Promise<void> => {
    if (nextUsername === undefined || !existing.ownerId) return;
    await db!
      .update(users)
      .set({ username: nextUsername })
      .where(eq(users.id, existing.ownerId));
  };

  if (Object.keys(set).length === 0) {
    await applyUsername();
    return mapBlog({ ...existing, username: nextUsername ?? existing.username });
  }

  try {
    const updated = await db
      .update(blogs)
      .set(set)
      .where(eq(blogs.id, existing.id))
      .returning();
    const row = updated[0];
    if (!row) throw new Error("Blog not found");
    await applyUsername();
    return mapBlog({
      ...row,
      author: existing.author,
      username: nextUsername ?? existing.username,
    });
  } catch (error) {
    if (isBlogsHandleConflict(error)) throw new Error("That handle is taken");
    throw error;
  }
}

export async function updateBlog(sub: string, patch: BlogPatch): Promise<Blog> {
  if (!db) throw new Error("updateBlog requires DATABASE_URL");
  const owned = (
    await db
      .select({ handle: blogs.handle })
      .from(blogs)
      .leftJoin(users, eq(blogs.ownerId, users.id))
      .where(and(eq(users.appleSub, sub), isNull(blogs.deletedAt)))
      .orderBy(asc(blogs.createdAt))
      .limit(1)
  )[0];
  if (!owned) throw new Error("No blog found for this user");
  return updateBlogByHandle(owned.handle, patch, { allowHandleChange: true });
}

// Get-or-create the signed-in user's blog. Upserts the user (keyed by Apple sub;
// Apple only sends name/email on first authorization, so existing values are
// preserved on later sign-ins) and provisions a starter blog on first sign-in.
export async function ensureOwnerBlog(user: StoreUser): Promise<Blog> {
  if (!db) throw new Error("ensureOwnerBlog requires DATABASE_URL");
  const owner = await upsertUser(user);

  const existing = await getOwnedBlog(user.sub);
  if (existing) {
    if (existing.username) return existing;
    const username = await ensureUserUsername(
      owner,
      usernameSeedForUser(user, existing.handle),
    );
    return { ...existing, username };
  }
  const name = user.name ? `${user.name}'s blog` : "My blog";
  const seed = user.email?.split("@")[0] || user.name || "blog";
  const username = await ensureUserUsername(owner, usernameSeedForUser(user, seed));

  // Provision the blog. ON CONFLICT DO NOTHING lets the DB settle the races: a
  // concurrent first sign-in that already made this owner's blog (owner unique
  // index) is a no-op, and a handle taken by a different owner (handle unique
  // index) just retries with a fresh handle. Either way we end with exactly one.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const handle = await uniqueHandle(seed);
    const inserted = await db
      .insert(blogs)
      .values({ handle, name, ownerId: owner.id })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) {
      await provisionNewWorkspaceDefaults(inserted[0].id);
      break;
    }
    const settled = await getOwnedBlog(user.sub);
    if (settled) return settled; // another request created this owner's blog
    // otherwise the handle collided with a different owner; try another handle
  }

  const created = await getOwnedBlog(user.sub);
  if (!created) throw new Error("failed to provision a blog");
  return { ...created, username: created.username ?? username };
}

// ---------------------------------------------------------------------------
// Account deletion
//
// The primitives only. src/lib/account-deletion.ts owns the order they run in
// and is the only place that knows the whole sequence. Everything here takes a
// blogId rather than a handle on purpose: CLOSE stamps blogs.deleted_at first,
// and every handle-based read in this file resolves through getBlogCore, which
// filters deleted workspaces out and is React-cache()d. After CLOSE the handle
// no longer resolves, so a handle-taking purge helper would throw.
// ---------------------------------------------------------------------------

/** Thrown when a session belongs to an account that was deleted. */
export class AccountDeletedError extends Error {
  constructor() {
    super("This account was deleted");
    this.name = "AccountDeletedError";
  }
}

/** One-way. The tombstone recognises a returning identity without recording it. */
export function hashAccountSub(sub: string): string {
  return createHash("sha256").update(sub).digest("hex");
}

export type AccountTombstone = {
  subHash: string;
  userId: string | null;
  blogId: string | null;
  username: string | null;
  handle: string | null;
  completedAt: Date | null;
};

export async function findAccountTombstone(
  sub: string,
): Promise<AccountTombstone | null> {
  if (!db) return null;
  const rows = await db
    .select({
      subHash: deletedAccounts.subHash,
      userId: deletedAccounts.userId,
      blogId: deletedAccounts.blogId,
      username: deletedAccounts.username,
      handle: deletedAccounts.handle,
      completedAt: deletedAccounts.completedAt,
    })
    .from(deletedAccounts)
    .where(eq(deletedAccounts.subHash, hashAccountSub(sub)))
    .limit(1);
  return rows[0] ?? null;
}

/** Every tombstone whose purge never finished, for the operator recovery command. */
export async function listPendingAccountTombstones(): Promise<AccountTombstone[]> {
  if (!db) return [];
  return db
    .select({
      subHash: deletedAccounts.subHash,
      userId: deletedAccounts.userId,
      blogId: deletedAccounts.blogId,
      username: deletedAccounts.username,
      handle: deletedAccounts.handle,
      completedAt: deletedAccounts.completedAt,
    })
    .from(deletedAccounts)
    .where(isNull(deletedAccounts.completedAt));
}

export async function completeAccountTombstone(subHash: string): Promise<void> {
  if (!db) return;
  await db
    .update(deletedAccounts)
    .set({ completedAt: new Date() })
    .where(eq(deletedAccounts.subHash, subHash));
}

/**
 * Lets an identity be used again. Only ever called when someone signs in
 * deliberately after deleting, and only once any owed purge has finished.
 */
export async function clearAccountTombstone(sub: string): Promise<void> {
  if (!db) return;
  await db
    .delete(deletedAccounts)
    .where(eq(deletedAccounts.subHash, hashAccountSub(sub)));
}

export type AccountDeletionSummary = {
  userId: string;
  sub: string;
  email: string | null;
  username: string | null;
  blogId: string;
  handle: string;
  workspaceName: string;
  documents: number;
  publishedDocuments: number;
  collaborators: number;
  apiTokens: number;
  hasCloudAiKey: boolean;
};

/**
 * What the person is about to lose, for the confirmation copy. Counts every
 * document including trashed ones, because Trash goes too.
 */
export async function getAccountDeletionSummary(
  sub: string,
): Promise<AccountDeletionSummary | null> {
  if (!db) return null;
  const owner = (
    await db
      .select({ id: users.id, email: users.email, username: users.username })
      .from(users)
      .where(eq(users.appleSub, sub))
      .limit(1)
  )[0];
  if (!owner) return null;
  const blog = (
    await db
      .select({ id: blogs.id, handle: blogs.handle, name: blogs.name })
      .from(blogs)
      .where(and(eq(blogs.ownerId, owner.id), isNull(blogs.deletedAt)))
      .limit(1)
  )[0];
  if (!blog) return null;

  const counted = await db
    .select({
      documents: sql<number>`count(*)::int`,
      published: sql<number>`count(*) filter (where ${posts.publishedAt} is not null)::int`,
    })
    .from(posts)
    .where(eq(posts.blogId, blog.id));
  // Collaborators are scoped, not owned: a workspace grant is scopeType
  // "workspace" with the blog id as scopeId. Revoked grants do not count.
  const shared = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(collaborators)
    .where(
      and(
        eq(collaborators.scopeType, "workspace"),
        eq(collaborators.scopeId, blog.id),
        isNull(collaborators.revokedAt),
      ),
    );
  const tokens = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, owner.id), isNull(apiTokens.revokedAt)));
  const aiKey = await db
    .select({ id: workspaceAiConfigs.blogId })
    .from(workspaceAiConfigs)
    .where(eq(workspaceAiConfigs.blogId, blog.id))
    .limit(1);

  return {
    userId: owner.id,
    sub,
    email: owner.email,
    username: owner.username,
    blogId: blog.id,
    handle: blog.handle,
    workspaceName: blog.name,
    documents: counted[0]?.documents ?? 0,
    publishedDocuments: counted[0]?.published ?? 0,
    collaborators: shared[0]?.n ?? 0,
    apiTokens: tokens[0]?.n ?? 0,
    hasCloudAiKey: Boolean(aiKey[0]),
  };
}

/**
 * Every blob URL reachable from a row in this workspace. Collected BEFORE any
 * row is deleted, because the rows carry the only addresses these files have.
 */
export async function listWorkspaceAssetUrls(blogId: string): Promise<string[]> {
  if (!db) return [];
  const rows = await db
    .select()
    .from(posts)
    .where(eq(posts.blogId, blogId));
  const urls = new Set<string>();
  for (const row of rows) {
    for (const ref of listItemAssetReferences(row as never)) {
      if (ref.url) urls.add(ref.url);
      // The pre-capture original, when a bookmark rehosted what it grabbed.
      if (ref.originalUrl) urls.add(ref.originalUrl);
    }
  }
  return [...urls];
}

/**
 * Documents and their dependents. emptyTrash widened from the trashed rows to
 * all of them. item_comments, document_capability_links and document_responses
 * cascade off posts and need no statement here.
 */
export async function purgeWorkspaceContent(blogId: string): Promise<number> {
  if (!db) throw new Error("purgeWorkspaceContent requires DATABASE_URL");
  const ids = (
    await db.select({ id: posts.id }).from(posts).where(eq(posts.blogId, blogId))
  ).map((row) => row.id);
  // Collab rows first: collab_state holds a post foreign key, so a document
  // that ever joined an epoch cannot be deleted while its state row lives.
  await deleteCollabDataForPostIds(ids);
  await db.delete(posts).where(eq(posts.blogId, blogId));
  await db.delete(folders).where(eq(folders.blogId, blogId));
  await db.delete(idempotencyKeys).where(eq(idempotencyKeys.blogId, blogId));
  return ids.length;
}

/** The workspace row. Cascades workspace_ai_config and document_templates. */
export async function deleteWorkspaceRow(blogId: string): Promise<void> {
  if (!db) throw new Error("deleteWorkspaceRow requires DATABASE_URL");
  await db.delete(blogs).where(eq(blogs.id, blogId));
}

/**
 * The user-level rows that block DELETE FROM users, in the order each unblocks
 * the next, followed by the identity residue that has no foreign key at all and
 * so would otherwise be left behind by any cascade-shaped design.
 */
export async function purgeUserIdentityRows(
  userId: string,
  sub: string,
  email: string | null,
): Promise<void> {
  if (!db) throw new Error("purgeUserIdentityRows requires DATABASE_URL");
  await db.delete(apiTokens).where(eq(apiTokens.userId, userId));
  await db.delete(appHealthReports).where(eq(appHealthReports.userId, userId));
  await db
    .delete(deviceLinks)
    .where(eq(deviceLinks.approvedByUserId, userId));
  await db
    .delete(collaborators)
    .where(
      or(
        eq(collaborators.userId, userId),
        eq(collaborators.invitedById, userId),
      ),
    );
  // No foreign key reaches these, so nothing above removed them.
  if (email) {
    await db
      .delete(verificationTokens)
      .where(eq(verificationTokens.identifier, email));
    // Invitations addressed TO this person by other people, in their workspaces.
    await db
      .delete(collaborators)
      .where(sql`lower(${collaborators.invitedEmail}) = lower(${email})`);
  }
  // Poll votes cast on OTHER people's documents. Both key shapes exist in the
  // wild: the responder key is written as `user:${userId ?? sub}`.
  await db
    .delete(documentResponses)
    .where(
      inArray(documentResponses.responderKey, [`user:${userId}`, `user:${sub}`]),
    );
}

/**
 * Severs the identity on the audit history without destroying it. Chunked
 * because every save writes an audit row, so an active account can hold six
 * figures of them and one statement would risk the function budget.
 *
 * Never a DELETE. These rows are the accountability record for every mutation,
 * including ones made by AI and by external agents.
 */
export async function anonymizeAuditActor(
  userId: string,
  batchSize = 5000,
): Promise<number> {
  if (!db) throw new Error("anonymizeAuditActor requires DATABASE_URL");
  let total = 0;
  for (let pass = 0; pass < 1000; pass += 1) {
    const batch = await db
      .select({ id: actionAudit.id })
      .from(actionAudit)
      .where(eq(actionAudit.actorUserId, userId))
      .limit(batchSize);
    if (batch.length === 0) break;
    await db
      .update(actionAudit)
      .set({ actorUserId: null })
      .where(inArray(actionAudit.id, batch.map((row) => row.id)));
    total += batch.length;
  }
  return total;
}

/** The users row. Last, once every reference above is gone. */
export async function deleteUserRow(userId: string): Promise<void> {
  if (!db) throw new Error("deleteUserRow requires DATABASE_URL");
  await db.delete(users).where(eq(users.id, userId));
}

// ---------------------------------------------------------------------------
// Content reports
// ---------------------------------------------------------------------------

const REPORT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A reader reporting a published page. Filed without an account, which is the
 * point: public pages are readable by anyone, so anyone must be able to say
 * something should not be there. Review is a human reading the open rows.
 */
export async function fileContentReport(input: {
  path: string;
  postId?: string;
  reason: string;
  reporterEmail?: string;
}): Promise<{ id: string } | null> {
  if (!db) return null;
  // The post reference is best effort: a wrong or stale id must not turn a
  // report into an error, so it is only kept when it names a real post.
  let postId: string | null = null;
  if (input.postId && REPORT_UUID_RE.test(input.postId)) {
    const exists = await db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, input.postId))
      .limit(1);
    if (exists[0]) postId = exists[0].id;
  }
  const inserted = await db
    .insert(contentReports)
    .values({
      path: input.path.slice(0, 512),
      postId,
      reason: input.reason.slice(0, 2000),
      reporterEmail: input.reporterEmail?.slice(0, 320) ?? null,
    })
    .returning({ id: contentReports.id });
  const row = inserted[0];
  if (!row) return null;
  await recordAction({
    actorUserId: null,
    actorType: "human",
    actionName: "report_content",
    targetType: "item",
    targetId: postId,
    inputSummary: input.path,
  });
  return { id: row.id };
}
