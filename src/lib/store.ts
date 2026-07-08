// Content access for the app. This is the ONLY content access point: routes and
// the editor go through here, never src/lib/demo.ts directly. With DATABASE_URL
// unset the app serves the demo seed so it runs with zero setup; with a database
// configured the same functions read and write Postgres (Drizzle + Neon).

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  like,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { cache } from "react";
import {
  BLOG_FOLDER_PATH,
  PRIVATE_POST_TYPES,
  isBlogBucketPath,
  isPrivatePostType,
  readingTimeMinForWordCount,
  wordCountForMarkdown,
} from "./content";
import type {
  Blog,
  BlogCardStyle,
  BlogHomeLayout,
  BookmarkCapture,
  CaptureStatus,
  Folder,
  FolderMode,
  LinkRef,
  Post,
  PostType,
} from "./content";
import { getBlogCore, getBlogCoreByUsername } from "./blog-core";
import { db } from "./db/client";
import { blogs, folders, posts, users } from "./db/schema";
import { folderModeForPostType } from "./markdown-files";
import { DEMO_BLOG, DEMO_POSTS } from "./demo";
import { rootDomainUrl } from "./site-url";
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
import { RESERVED_HANDLES, TENANT_HANDLE_RE } from "./tenants";

type PostRow = typeof posts.$inferSelect;
type PostFolderRow = Pick<PostRow, "id" | "folderId" | "type">;
type PostListRow = Pick<
  PostRow,
  | "id"
  | "blogId"
  | "folderId"
  | "type"
  | "slug"
  | "title"
  | "excerpt"
  | "accent"
  | "cover"
  | "coverCaption"
  | "coverHeight"
  | "videoUrl"
  | "venue"
  | "duration"
  | "captureStatus"
  | "status"
  | "pinned"
  | "publishedAt"
  | "createdAt"
  | "updatedAt"
  | "wordCount"
> & {
  bodyPreview: string | null;
  captureUrl: string | null;
  captureTitle: string | null;
  captureDescription: string | null;
  captureScreenshotUrl: string | null;
  captureHtmlUrl: string | null;
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
  homeLayout?: BlogHomeLayout;
  username?: string;
};
export type AdjacentPostLink = Pick<Post, "slug" | "title">;
export type AdjacentPublishedPosts = {
  previous: AdjacentPostLink | null;
  next: AdjacentPostLink | null;
};
export type BlogEditRecord = {
  id: string;
  handle: string;
  name: string;
  ownerId: string | null;
  editTokenHash: string | null;
};
export type AnonymousBlogRecord = {
  id: string;
  handle: string;
};
export type StoreUser = {
  sub: string;
  name?: string;
  email?: string;
};

export const DEFAULT_ANONYMOUS_BLOG_NAME = "Untitled blog";
const DEFAULT_CARD_STYLE: BlogCardStyle = "cover";
const DEFAULT_HOME_LAYOUT: BlogHomeLayout = "grid";

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
  return {
    id: row.id,
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
    videoUrl: row.videoUrl ?? undefined,
    venue: row.venue ?? undefined,
    duration: row.duration ?? undefined,
    body: row.body,
    wordCount,
    readingTime: readingTimeMinForWordCount(wordCount),
    captureStatus: cleanCaptureStatus(row.captureStatus),
    capture: row.capture ?? undefined,
    date: toISODate(row.publishedAt ?? row.createdAt),
    status: row.status,
    pinned: row.pinned,
    folderId: row.folderId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function compactCapture(row: PostListRow): BookmarkCapture | undefined {
  const capture: Partial<BookmarkCapture> = {
    url: row.captureUrl ?? undefined,
    title: row.captureTitle ?? undefined,
    description: row.captureDescription ?? undefined,
    screenshotUrl: row.captureScreenshotUrl ?? undefined,
    htmlUrl: row.captureHtmlUrl ?? undefined,
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
    type: row.type,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? undefined,
    accent: row.accent ?? undefined,
    cover: row.cover ?? undefined,
    coverCaption: row.coverCaption ?? undefined,
    coverHeight: row.coverHeight ?? undefined,
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
    folderId: row.folderId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const BODY_PREVIEW_LENGTH = 2048;

function bodyPreviewSql(): SQL<string | null> {
  return sql<string | null>`nullif(left(${posts.body}, ${BODY_PREVIEW_LENGTH}), '')`;
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
    type: posts.type,
    slug: posts.slug,
    title: posts.title,
    excerpt: posts.excerpt,
    accent: posts.accent,
    cover: posts.cover,
    coverCaption: posts.coverCaption,
    coverHeight: posts.coverHeight,
    videoUrl: posts.videoUrl,
    venue: posts.venue,
    duration: posts.duration,
    captureStatus: posts.captureStatus,
    status: posts.status,
    pinned: posts.pinned,
    publishedAt: posts.publishedAt,
    createdAt: posts.createdAt,
    updatedAt: posts.updatedAt,
    wordCount: wordCountSql(),
    bodyPreview: bodyPreviewSql(),
    captureUrl: sql<string | null>`${posts.capture}->>'url'`,
    captureTitle: sql<string | null>`${posts.capture}->>'title'`,
    captureDescription: sql<string | null>`${posts.capture}->>'description'`,
    captureScreenshotUrl: sql<string | null>`${posts.capture}->>'screenshotUrl'`,
    captureHtmlUrl: sql<string | null>`${posts.capture}->>'htmlUrl'`,
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
  if (!db) {
    return handle === DEMO_BLOG.handle ? DEMO_BLOG : null;
  }
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
  if (!db) {
    return username === DEMO_BLOG.username ? DEMO_BLOG : null;
  }
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
            eq(posts.status, "published"),
            publicPostTypePredicate(),
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
  return rows.map(mapPostList);
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
  if (!db) {
    if (handle !== DEMO_BLOG.handle) return [];
    return pinnedFirst(
      DEMO_POSTS.filter(
        (p) => p.status === "published" && !isPrivatePostType(p.type),
      ),
    );
  }
  return selectPosts(handle, true);
}

const getPostsCached = cache(getPostsUncached);

export async function getPosts(handle: string): Promise<Post[]> {
  return getPostsCached(handle);
}

async function getAllPostsUncached(handle: string): Promise<Post[]> {
  if (!db) {
    return handle === DEMO_BLOG.handle ? pinnedFirst(DEMO_POSTS) : [];
  }
  return selectPosts(handle, false);
}

const getAllPostsCached = cache(getAllPostsUncached);

export async function getAllPosts(handle: string): Promise<Post[]> {
  return getAllPostsCached(handle);
}

export async function countAllPosts(handle: string): Promise<number> {
  if (!db) return handle === DEMO_BLOG.handle ? DEMO_POSTS.length : 0;
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
  slug: string,
): Promise<AdjacentPublishedPosts> {
  const published = await getPosts(handle);
  const index = published.findIndex((post) => post.slug === slug);
  if (index < 0) return { previous: null, next: null };

  const previous = published[index - 1];
  const next = published[index + 1];
  return {
    previous: previous
      ? { slug: previous.slug, title: previous.title }
      : null,
    next: next ? { slug: next.slug, title: next.title } : null,
  };
}

async function getPostUncached(
  handle: string,
  slug: string,
): Promise<Post | null> {
  if (!db) {
    if (handle !== DEMO_BLOG.handle) return null;
    return DEMO_POSTS.find((p) => p.slug === slug) ?? null;
  }
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
  return getPostCached(handle, slug);
}

async function blogIdFor(handle: string): Promise<string> {
  const id = (await getBlogCore(handle))?.id;
  if (!id) throw new Error(`unknown blog "${handle}"`);
  return id;
}

// Every workspace has these three system folders. Provisioning creates them,
// and the migration backfills older workspaces so reads never write.
const WORKSPACE_FOLDERS: ReadonlyArray<Omit<Folder, "id">> = [
  { name: "Blog", path: "blog", mode: "blog", position: 0 },
  { name: "Notes", path: "notes", mode: "notes", position: 1 },
  { name: "Bookmarks", path: "bookmarks", mode: "bookmarks", position: 2 },
];

const DEFAULT_FOLDER_PATH = BLOG_FOLDER_PATH;

const DEMO_FOLDERS: Folder[] = WORKSPACE_FOLDERS.map((folder) => ({
  id: `demo-${folder.path}-folder`,
  ...folder,
}));

const STARTER_BLOG_POST = {
  slug: "welcome-to-your-blog",
  title: "Welcome to your blog",
  body: `This is a real draft in the Blog folder. Edit it, delete it, or publish it when you are ready.

## Create

Press C anywhere in the workspace to create a new article in the current folder.

## Commands

Type / in the editor for blocks and formatting. Press Command K to search commands and move around your workspace.

## Publish

When a draft is ready, choose Publish in the top bar or run "Publish or unpublish" from Command K. Published articles appear on your public blog. Notes and bookmarks stay private.`,
};

const STARTER_NOTE = {
  slug: "scratch-note",
  title: "Scratch note",
  body: "Use this private note for rough ideas. Notes never publish to your blog.",
};

const STARTER_BOOKMARK = {
  slug: "write-ai-setup-guide",
  title: "Write AI setup guide",
};

function starterBookmarkUrl(): string {
  return new URL("/docs/ai", rootDomainUrl()).toString();
}

function starterBookmarkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return rootDomainUrl().hostname.replace(/^www\./, "");
  }
}

/** The system folder path a post of this type lives in. */
export function folderPathForPostType(type: PostType): string {
  if (type === "note") return "notes";
  if (type === "bookmark") return "bookmarks";
  return DEFAULT_FOLDER_PATH;
}

function publicPostTypePredicate(): SQL {
  return and(...PRIVATE_POST_TYPES.map((type) => ne(posts.type, type)))!;
}

function blogBucketTypePredicate(folderPath: string): SQL | undefined {
  return isBlogBucketPath(folderPath) ? publicPostTypePredicate() : undefined;
}

function excludePrivateTypesFromBlogBucket<T extends { type: PostType }>(
  folderPath: string,
  items: T[],
): T[] {
  if (!isBlogBucketPath(folderPath)) return items;
  return items.filter((item) => !isPrivatePostType(item.type));
}

function mapFolder(row: typeof folders.$inferSelect): Folder {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    mode: cleanFolderMode(row.mode),
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
 * subfolder). Mode is inherited from the parent, so everything under Notes
 * stays notes-mode (and its items stay unlisted) no matter how deep. The
 * full path carries the ancestry; collisions get a numeric suffix.
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
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return mapFolder(inserted[0]);
  }
  throw new Error("A folder with that name already exists here.");
}

/**
 * Bookmarks waiting for a capture agent (normally the Mac app). Each entry
 * carries the URL to capture: the first link's href, set at creation.
 */
export async function listPendingCaptures(
  handle: string,
): Promise<Array<{ id: string; slug: string; title: string; url: string }>> {
  if (!db) return [];
  const blogId = await blogIdFor(handle);
  const rows = await db
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      linkHref: sql<string | null>`${posts.links}->0->>'href'`,
      captureUrl: sql<string | null>`${posts.capture}->>'url'`,
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
     * Mac app, with screenshot and original HTML) still claims the bookmark.
     */
    keepPending?: boolean;
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
  const readable = opts.readableMarkdown?.trim();
  const body = row.body.trim() === "" && readable ? readable : row.body;
  const merged: BookmarkCapture = { ...(row.capture ?? {}), ...capture };
  let excerpt = row.excerpt;
  if (!row.excerpt?.trim()) {
    const clean = (value: string | undefined) =>
      (value ?? "").replace(/\s+/g, " ").trim();
    const truncate = (value: string) => {
      if (value.length <= 200) return value;
      const sliced = value.slice(0, 197).trimEnd();
      const wordBreak = sliced.lastIndexOf(" ");
      return `${wordBreak > 120 ? sliced.slice(0, wordBreak) : sliced}...`;
    };
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
    const autoExcerpt = truncate(
      clean(merged.description) || clean(merged.siteName) || urlHost,
    );
    if (autoExcerpt) excerpt = autoExcerpt;
  }
  const updated = await db
    .update(posts)
    .set({
      capture: merged,
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
    .where(eq(posts.id, row.id))
    .returning();
  return updated[0] ? mapPost(updated[0]) : null;
}

/** Enter a fresh bookmark into the capture pipeline. */
export async function markCapturePending(
  handle: string,
  postId: string,
  url: string,
): Promise<void> {
  if (!db) return;
  const blogId = await blogIdFor(handle);
  await db
    .update(posts)
    .set({ captureStatus: "pending", capture: { url }, updatedAt: new Date() })
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.blogId, blogId),
        eq(posts.type, "bookmark"),
        isNull(posts.deletedAt),
      ),
    );
}

/**
 * Move a post into a folder by path. The target folder's mode must match the
 * post's kind family (a blog post cannot move into a notes folder and vice
 * versa), so an article can be filed under any blog subfolder but never
 * becomes an unlisted note. Returns the updated post.
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
  const postMode = folderModeForPostType(row.type);
  if (cleanFolderMode(folder.mode) !== postMode) {
    throw new Error(
      `A ${row.type} cannot move into the ${folder.mode} folder.`,
    );
  }
  const updated = await db
    .update(posts)
    .set({ folderId: folder.id, updatedAt: new Date() })
    .where(eq(posts.id, row.id))
    .returning();
  return updated[0] ? mapPost(updated[0]) : null;
}

/** One folder by its full path, or null. */
export async function getFolderByPath(
  handle: string,
  path: string,
): Promise<Folder | null> {
  if (!db) {
    return DEMO_FOLDERS.find((folder) => folder.path === path) ?? null;
  }
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

function cleanFolderMode(value: string | null): FolderMode {
  if (value === "notes" || value === "bookmarks") return value;
  return "blog";
}

async function workspaceFoldersByBlogId(blogId: string): Promise<Folder[]> {
  if (!db) return DEMO_FOLDERS;
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
  if (!db) return DEMO_FOLDERS;
  await db
    .insert(folders)
    .values(WORKSPACE_FOLDERS.map((folder) => ({ blogId, ...folder })))
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
  const bookmarkUrl = starterBookmarkUrl();
  const bookmarkLabel = starterBookmarkLabel(bookmarkUrl);

  await db!
    .insert(posts)
    .values([
      {
        blogId,
        folderId: blogFolderId,
        type: "article",
        slug: STARTER_BLOG_POST.slug,
        title: STARTER_BLOG_POST.title,
        body: STARTER_BLOG_POST.body,
        wordCount: wordCountForMarkdown(STARTER_BLOG_POST.body),
        status: "draft",
      },
      {
        blogId,
        folderId: notesFolderId,
        type: "note",
        slug: STARTER_NOTE.slug,
        title: STARTER_NOTE.title,
        body: STARTER_NOTE.body,
        wordCount: wordCountForMarkdown(STARTER_NOTE.body),
        status: "draft",
      },
      {
        blogId,
        folderId: bookmarksFolderId,
        type: "bookmark",
        slug: STARTER_BOOKMARK.slug,
        title: STARTER_BOOKMARK.title,
        links: [{ label: bookmarkLabel, href: bookmarkUrl }],
        captureStatus: "pending",
        capture: { url: bookmarkUrl },
        body: "",
        wordCount: 0,
        status: "draft",
      },
    ])
    .onConflictDoNothing({
      target: [posts.blogId, posts.slug],
      where: sql`${posts.deletedAt} is null`,
    });
}

// Resolve the default "blog" folder. Creation is handled during workspace
// provisioning, and older workspaces are handled by the migration backfill.
export async function ensureDefaultFolder(blogId: string): Promise<Folder> {
  return folderForPostType(blogId, "article");
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
  if (!db) {
    return handle === DEMO_BLOG.handle ? DEMO_FOLDERS : [];
  }
  const rows = await db
    .select({
      id: folders.id,
      blogId: folders.blogId,
      name: folders.name,
      path: folders.path,
      parentId: folders.parentId,
      mode: folders.mode,
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
  if (!db) {
    if (handle !== DEMO_BLOG.handle) return [];
    const folderPosts = DEMO_POSTS.filter(
      (post) =>
        folderPathForPostType(post.type) === folderPath &&
        (!publishedOnly || post.status === "published"),
    );
    return pinnedFirst(
      excludePrivateTypesFromBlogBucket(folderPath, folderPosts),
    );
  }

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
        publishedOnly ? eq(posts.status, "published") : undefined,
        blogBucketTypePredicate(folderPath),
        inFolder,
      ),
    )
    .orderBy(
      desc(posts.pinned),
      publishedOnly ? desc(posts.publishedAt) : desc(posts.updatedAt),
      desc(posts.createdAt),
    );
  return excludePrivateTypesFromBlogBucket(
    folderPath,
    rows.map(mapPostList),
  );
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
            eq(posts.status, "published"),
            publicPostTypePredicate(),
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
  return rows.map((r) => mapPost(r.posts));
}

async function getPublishedPostFilesUncached(handle: string): Promise<Post[]> {
  if (!db) {
    if (handle !== DEMO_BLOG.handle) return [];
    return pinnedFirst(
      DEMO_POSTS.filter(
        (p) => p.status === "published" && !isPrivatePostType(p.type),
      ),
    );
  }
  return selectFullPosts(handle, true);
}

const getPublishedPostFilesCached = cache(getPublishedPostFilesUncached);

export async function getPublishedPostFiles(handle: string): Promise<Post[]> {
  return getPublishedPostFilesCached(handle);
}

async function getAllPostFilesUncached(handle: string): Promise<Post[]> {
  if (!db) {
    return handle === DEMO_BLOG.handle ? pinnedFirst(DEMO_POSTS) : [];
  }
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
): Promise<Post[]> {
  if (!db) {
    if (handle !== DEMO_BLOG.handle) return [];
    const folderPosts = DEMO_POSTS.filter(
      (post) =>
        folderPathForPostType(post.type) === folderPath &&
        (!publishedOnly || post.status === "published"),
    );
    return pinnedFirst(
      excludePrivateTypesFromBlogBucket(folderPath, folderPosts),
    );
  }

  const inFolder =
    folderPath === DEFAULT_FOLDER_PATH
      ? or(
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
        publishedOnly ? eq(posts.status, "published") : undefined,
        blogBucketTypePredicate(folderPath),
        inFolder,
      ),
    )
    .orderBy(
      desc(posts.pinned),
      publishedOnly ? desc(posts.publishedAt) : desc(posts.updatedAt),
      desc(posts.createdAt),
    );
  return excludePrivateTypesFromBlogBucket(
    folderPath,
    rows.map((r) => mapPost(r.posts)),
  );
}

const getFolderPostFilesCached = cache(getFolderPostFilesUncached);

export async function getFolderPostFiles(
  handle: string,
  folderPath: string,
  opts: { publishedOnly?: boolean } = {},
): Promise<Post[]> {
  return getFolderPostFilesCached(
    handle,
    folderPath,
    opts.publishedOnly ?? false,
  );
}

// Live (not trashed) item counts per folder path, drafts included, in one
// grouped query. A NULL folder_id counts toward the default "blog" folder.
async function getFolderCountsUncached(handle: string): Promise<Record<string, number>> {
  if (!db) {
    if (handle !== DEMO_BLOG.handle) return {};
    const counts: Record<string, number> = {};
    for (const post of DEMO_POSTS) {
      const path = folderPathForPostType(post.type);
      counts[path] = (counts[path] ?? 0) + 1;
    }
    return counts;
  }
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
  const folderPosts = excludePrivateTypesFromBlogBucket(
    folderPath,
    await getFolderPosts(handle, folderPath, opts),
  );
  const ids = await accessiblePostIdsForUser(handle, user);
  if (ids === "all") return folderPosts;
  return folderPosts.filter((post) => Boolean(post.id && ids.has(post.id)));
}

export async function getAccessibleFolderPostFiles(
  handle: string,
  folderPath: string,
  user: AccessUser | null,
  opts: { publishedOnly?: boolean } = {},
): Promise<Post[]> {
  if (!db || !user) return [];
  const folderPosts = excludePrivateTypesFromBlogBucket(
    folderPath,
    await getFolderPostFiles(handle, folderPath, opts),
  );
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

/** The owner's pricing plan for a blog, or null (unclaimed / demo mode). */
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
    editTokenHash: row.editTokenHash,
  };
}

const getBlogEditRecordCached = cache(getBlogEditRecordUncached);

export async function getBlogEditRecord(
  handle: string,
): Promise<BlogEditRecord | null> {
  return getBlogEditRecordCached(handle);
}

export async function getUnclaimedBlogEditRecordsByIds(
  ids: string[],
): Promise<BlogEditRecord[]> {
  if (!db || ids.length === 0) return [];
  return db
    .select({
      id: blogs.id,
      handle: blogs.handle,
      name: blogs.name,
      ownerId: blogs.ownerId,
      editTokenHash: blogs.editTokenHash,
    })
    .from(blogs)
    .where(
      and(
        inArray(blogs.id, ids),
        isNull(blogs.ownerId),
        isNull(blogs.deletedAt),
      ),
    )
    .orderBy(desc(blogs.createdAt));
}

export async function isBlogOwner(
  handle: string,
  sub: string,
): Promise<boolean> {
  if (!db) return false;
  const row = await getBlogCore(handle);
  return Boolean(row?.ownerSub && row.ownerSub === sub);
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

function isPostsBlogSlugConflict(error: unknown): boolean {
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
  if (constraint === "posts_blog_slug_idx") return true;
  return code === "23505" && (message + detail).includes("posts_blog_slug_idx");
}

export type PostContentPatch = Partial<
  Pick<Post, "title" | "body" | "cover" | "coverCaption" | "coverHeight">
>;

function hasOwnContentKey<K extends keyof PostContentPatch>(
  patch: PostContentPatch,
  key: K,
): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

// Persist the editor's draft. Requires a database (the demo seed is read only).
// Updates the row by id, scoped to this blog so a stale or foreign id can never
// touch another tenant, so a slug edit renames in place; otherwise inserts,
// upserting on the (blog, slug) unique index. For a published post, published_at
// follows the editor's Date field (or is stamped now on first publish); a draft
// leaves any existing published_at untouched, so unpublish then republish keeps
// the original date.
type SavePostOptions = {
  preservePublishedAt?: boolean;
};

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
  // Never taken from the client Post: an update keeps the stored folder and
  // an insert lands in the folder matching the post's type (moves are a
  // store-level concern).
  const insertFolder = await folderForPostType(blogId, post.type);
  // Notes and bookmarks are always unlisted: no save path may publish them.
  const status =
    post.type === "note" || post.type === "bookmark" ? "draft" : post.status;
  const wordCount = wordCountForMarkdown(post.body);
  const base = {
    type: post.type,
    title: post.title,
    excerpt: post.excerpt ?? null,
    accent: post.accent ?? null,
    cover: post.cover ?? null,
    coverCaption: post.coverCaption ?? null,
    coverHeight: post.coverHeight ?? null,
    gallery: post.gallery ?? null,
    links: post.links ?? null,
    videoUrl: post.videoUrl ?? null,
    venue: post.venue ?? null,
    duration: post.duration ?? null,
    body: post.body,
    wordCount,
    status,
    pinned: post.pinned ?? false,
    updatedAt: new Date(),
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
      const updated = await db
        .update(posts)
        .set({ ...set, slug: post.slug })
        .where(
          and(
            eq(posts.id, post.id),
            eq(posts.blogId, blogId),
            isNull(posts.deletedAt),
          ),
        )
        .returning();
      if (updated[0]) return mapPost(updated[0]);
      if (options.preservePublishedAt) throw new Error("Post not found");
    }

    const inserted = await db
      .insert(posts)
      .values({
        blogId,
        folderId: insertFolder.id,
        slug: post.slug,
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
        target: [posts.blogId, posts.slug],
        targetWhere: sql`${posts.deletedAt} is null`,
        set,
      })
      .returning();
    return mapPost(inserted[0]);
  } catch (error) {
    if (isPostsBlogSlugConflict(error)) throw new Error("That URL is already used");
    throw error;
  }
}

export async function savePostContentPatch(
  handle: string,
  existing: Post,
  patch: PostContentPatch,
): Promise<Post> {
  const next: Post = {
    ...existing,
    type: existing.type,
    slug: existing.slug,
    status: existing.status,
    pinned: existing.pinned,
    folderId: existing.folderId,
    date: existing.date,
  };

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

  return savePost(handle, next, { preservePublishedAt: true });
}

// Create an empty draft and return it (with its new id), for the editor's
// "New draft" action. Requires a database. The draft lands in the system
// folder matching its type: note -> notes, bookmark -> bookmarks, else blog.
export async function createDraft(
  handle: string,
  type: PostType = "article",
): Promise<Post> {
  if (!db) throw new Error("createDraft requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  const folder = await folderForPostType(blogId, type);
  const slug = `untitled-${Date.now().toString(36)}`;
  const inserted = await db
    .insert(posts)
    .values({
      blogId,
      folderId: folder.id,
      type,
      slug,
      title: "",
      excerpt: "",
      body: "",
      wordCount: 0,
      status: "draft",
    })
    .returning();
  return mapPost(inserted[0]);
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
    if (!taken[0]) return candidate;
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
export async function getUserIdBySub(sub: string): Promise<string | null> {
  if (!db) return null;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.appleSub, sub))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function upsertUser(
  user: StoreUser,
): Promise<{ id: string; name: string | null; username: string | null }> {
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
    if (!taken[0]) return candidate;
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

function cleanStoredHomeLayout(value: unknown): BlogHomeLayout {
  if (value === "single" || value === "timeline" || value === "grid" || value === "index") {
    return value;
  }
  if (value === "cards") return "grid";
  return DEFAULT_HOME_LAYOUT;
}

function cleanBlogCardStyle(value: unknown): BlogCardStyle {
  if (value === "cover" || value === "minimal") return value;
  throw new Error("Card style must be Cover or Minimal");
}

function cleanBlogHomeLayout(value: unknown): BlogHomeLayout {
  if (value === "single" || value === "timeline" || value === "grid" || value === "index") {
    return value;
  }
  if (value === "cards") return "grid";
  throw new Error("Home layout must be Single, Timeline, Grid, or Index");
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

function isBlogsOwnerConflict(error: unknown): boolean {
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
  if (constraint === "blogs_owner_idx") return true;
  return code === "23505" && (message + detail).includes("blogs_owner_idx");
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

export async function createAnonymousBlogRecord(
  editTokenHash: string,
  seed: string,
  homeLayout: BlogHomeLayout = DEFAULT_HOME_LAYOUT,
): Promise<AnonymousBlogRecord> {
  if (!db) throw new Error("createAnonymousBlog requires DATABASE_URL");
  if (!editTokenHash) throw new Error("edit token hash is required");

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const handle = await uniqueHandle(attempt === 0 ? seed : `${seed}-${attempt + 1}`);
    const inserted = await db
      .insert(blogs)
      .values({
        handle,
        name: DEFAULT_ANONYMOUS_BLOG_NAME,
        homeLayout: cleanBlogHomeLayout(homeLayout),
        ownerId: null,
        editTokenHash,
      })
      .onConflictDoNothing()
      .returning({ id: blogs.id, handle: blogs.handle });
    if (inserted[0]) {
      await provisionNewWorkspaceDefaults(inserted[0].id);
      return inserted[0];
    }
  }

  throw new Error("failed to create a blog");
}

export async function claimBlogForUser(
  handle: string,
  user: StoreUser,
): Promise<Blog> {
  if (!db) throw new Error("claimBlog requires DATABASE_URL");

  const owner = await upsertUser(user);
  const existingOwned = await getOwnedBlog(user.sub);
  if (existingOwned) throw new Error("You already have a blog");

  const target = await getBlogEditRecord(handle);
  if (!target) throw new Error("Blog not found");
  if (target.ownerId) throw new Error("This blog is already claimed");
  const username = await ensureUserUsername(owner, usernameSeedForUser(user, handle));

  try {
    const updated = await db
      .update(blogs)
      .set({ ownerId: owner.id, editTokenHash: null })
      .where(
        and(
          eq(blogs.id, target.id),
          isNull(blogs.ownerId),
          isNull(blogs.deletedAt),
        ),
      )
      .returning();
    const row = updated[0];
    if (!row) throw new Error("This blog is already claimed");
    return mapBlog({ ...row, author: owner.name, username });
  } catch (error) {
    if (isBlogsOwnerConflict(error)) throw new Error("You already have a blog");
    throw error;
  }
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
