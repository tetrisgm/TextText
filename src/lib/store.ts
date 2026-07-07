// Content access for the app. This is the ONLY content access point: routes and
// the editor go through here, never src/lib/demo.ts directly. With DATABASE_URL
// unset the app serves the demo seed so it runs with zero setup; with a database
// configured the same functions read and write Postgres (Drizzle + Neon).

import { and, asc, desc, eq, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import type {
  Blog,
  BlogCardStyle,
  BlogHomeLayout,
  BookmarkCapture,
  CaptureStatus,
  Folder,
  FolderMode,
  Post,
  PostType,
} from "./content";
import { db } from "./db/client";
import { blogs, folders, posts, users } from "./db/schema";
import { folderModeForPostType } from "./markdown-files";
import { DEMO_BLOG, DEMO_POSTS } from "./demo";
import {
  RESERVED_USERNAMES,
  USERNAME_RE,
  cleanUsername,
  slugifyUsername,
} from "./public-paths";
import { RESERVED_HANDLES, TENANT_HANDLE_RE } from "./tenants";

type PostRow = typeof posts.$inferSelect;
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

function mapPost(row: PostRow): Post {
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

export async function getBlog(handle: string): Promise<Blog | null> {
  if (!db) {
    return handle === DEMO_BLOG.handle ? DEMO_BLOG : null;
  }
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
    .where(and(eq(blogs.handle, handle), isNull(blogs.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return mapBlog(row);
}

export async function getBlogByUsername(usernameInput: string): Promise<Blog | null> {
  // Lookups normalize but never validate: reserved-ness only matters when a
  // username is SET, and the seeded demo username is reserved yet resolvable.
  const username = usernameInput.trim().toLowerCase();
  if (!username || !/^[a-z0-9-]{1,30}$/.test(username)) return null;
  if (!db) {
    return username === DEMO_BLOG.username ? DEMO_BLOG : null;
  }
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
    .innerJoin(users, eq(blogs.ownerId, users.id))
    .where(and(eq(users.username, username), isNull(blogs.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return mapBlog(row);
}

async function selectPosts(handle: string, publishedOnly: boolean): Promise<Post[]> {
  const rows = await db!
    .select()
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      publishedOnly
        ? and(
            eq(blogs.handle, handle),
            eq(posts.status, "published"),
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

export async function getPosts(handle: string): Promise<Post[]> {
  if (!db) {
    if (handle !== DEMO_BLOG.handle) return [];
    return pinnedFirst(DEMO_POSTS.filter((p) => p.status === "published"));
  }
  return selectPosts(handle, true);
}

export async function getAllPosts(handle: string): Promise<Post[]> {
  if (!db) {
    return handle === DEMO_BLOG.handle ? pinnedFirst(DEMO_POSTS) : [];
  }
  return selectPosts(handle, false);
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

export async function getPost(
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

async function blogIdFor(handle: string): Promise<string> {
  const rows = await db!
    .select({ id: blogs.id })
    .from(blogs)
    .where(and(eq(blogs.handle, handle), isNull(blogs.deletedAt)))
    .limit(1);
  const id = rows[0]?.id;
  if (!id) throw new Error(`unknown blog "${handle}"`);
  return id;
}

// Every workspace has these three system folders. ensureWorkspaceFolders
// creates any that are missing, so workspaces from before Notes and Bookmarks
// landed gain them lazily on first read.
const WORKSPACE_FOLDERS: ReadonlyArray<Omit<Folder, "id">> = [
  { name: "Blog", path: "blog", mode: "blog", position: 0 },
  { name: "Notes", path: "notes", mode: "notes", position: 1 },
  { name: "Bookmarks", path: "bookmarks", mode: "bookmarks", position: 2 },
];

const DEFAULT_FOLDER_PATH = "blog";

const DEMO_FOLDERS: Folder[] = WORKSPACE_FOLDERS.map((folder) => ({
  id: `demo-${folder.path}-folder`,
  ...folder,
}));

/** The system folder path a post of this type lives in. */
export function folderPathForPostType(type: PostType): string {
  if (type === "note") return "notes";
  if (type === "bookmark") return "bookmarks";
  return DEFAULT_FOLDER_PATH;
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
    .select()
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
      url: row.links?.[0]?.href ?? row.capture?.url ?? "",
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
  const updated = await db
    .update(posts)
    .set({
      capture: merged,
      captureStatus: opts.keepPending
        ? "pending"
        : opts.failed
          ? "failed"
          : "captured",
      body,
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

// Get-or-create ALL the system folders: one multi-row INSERT with ON CONFLICT
// DO NOTHING settles races on the (blog, path) partial unique index, same
// pattern as blogs, then one SELECT reads the settled rows back in order.
export async function ensureWorkspaceFolders(blogId: string): Promise<Folder[]> {
  if (!db) return DEMO_FOLDERS;
  await db
    .insert(folders)
    .values(WORKSPACE_FOLDERS.map((folder) => ({ blogId, ...folder })))
    .onConflictDoNothing();
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
  if (rows.length < WORKSPACE_FOLDERS.length) {
    throw new Error("failed to ensure the workspace folders");
  }
  return rows.map(mapFolder);
}

// Get-or-create the default "blog" folder (the whole system set is ensured on
// the way, so any caller of the default folder also heals older workspaces).
export async function ensureDefaultFolder(blogId: string): Promise<Folder> {
  return folderForPostType(blogId, "article");
}

// The system folder a post of this type belongs in, ensured to exist.
async function folderForPostType(
  blogId: string,
  type: PostType,
): Promise<Folder> {
  const ensured = await ensureWorkspaceFolders(blogId);
  const path = folderPathForPostType(type);
  const folder = ensured.find((entry) => entry.path === path);
  if (!folder) throw new Error(`failed to ensure the "${path}" folder`);
  return folder;
}

export async function getFolders(handle: string): Promise<Folder[]> {
  if (!db) {
    return handle === DEMO_BLOG.handle ? DEMO_FOLDERS : [];
  }
  const blogId = await blogIdFor(handle);
  // Ensure the system folders exist first: workspaces created before Notes
  // and Bookmarks landed gain them here on read.
  const ensured = await ensureWorkspaceFolders(blogId);
  const rows = await db
    .select()
    .from(folders)
    .where(and(eq(folders.blogId, blogId), isNull(folders.deletedAt)))
    .orderBy(asc(folders.position), asc(folders.createdAt));
  if (rows.length === 0) return ensured;
  return rows.map(mapFolder);
}

// Posts scoped to one folder of the workspace, identified by its path. Posts
// with a NULL folder_id (created before the folders backfill) count as living
// in the default "blog" folder.
export async function getFolderPosts(
  handle: string,
  folderPath: string,
  opts: { publishedOnly?: boolean } = {},
): Promise<Post[]> {
  const publishedOnly = opts.publishedOnly ?? false;
  if (!db) {
    if (handle !== DEMO_BLOG.handle) return [];
    return pinnedFirst(
      DEMO_POSTS.filter(
        (post) =>
          folderPathForPostType(post.type) === folderPath &&
          (!publishedOnly || post.status === "published"),
      ),
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
        inFolder,
      ),
    )
    .orderBy(
      desc(posts.pinned),
      publishedOnly ? desc(posts.publishedAt) : desc(posts.updatedAt),
      desc(posts.createdAt),
    );
  return rows.map((r) => mapPost(r.posts));
}

// Live (not trashed) item counts per folder path, drafts included, in one
// grouped query. A NULL folder_id counts toward the default "blog" folder.
export async function getFolderCounts(
  handle: string,
): Promise<Record<string, number>> {
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

/** The owner's pricing plan for a blog, or null (unclaimed / demo mode). */
export async function getOwnerPlan(handle: string): Promise<string | null> {
  if (!db) return null;
  const rows = await db
    .select({ plan: users.plan })
    .from(blogs)
    .leftJoin(users, eq(blogs.ownerId, users.id))
    .where(and(eq(blogs.handle, handle), isNull(blogs.deletedAt)))
    .limit(1);
  return rows[0]?.plan ?? null;
}

export async function getBlogEditRecord(
  handle: string,
): Promise<BlogEditRecord | null> {
  if (!db) return null;
  const rows = await db
    .select({
      id: blogs.id,
      handle: blogs.handle,
      name: blogs.name,
      ownerId: blogs.ownerId,
      editTokenHash: blogs.editTokenHash,
    })
    .from(blogs)
    .where(and(eq(blogs.handle, handle), isNull(blogs.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
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
  const rows = await db
    .select({ id: blogs.id })
    .from(blogs)
    .leftJoin(users, eq(blogs.ownerId, users.id))
    .where(
      and(
        eq(blogs.handle, handle),
        eq(users.appleSub, sub),
        isNull(blogs.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
}

export async function getPostById(
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

// Persist the editor's draft. Requires a database (the demo seed is read only).
// Updates the row by id, scoped to this blog so a stale or foreign id can never
// touch another tenant, so a slug edit renames in place; otherwise inserts,
// upserting on the (blog, slug) unique index. For a published post, published_at
// follows the editor's Date field (or is stamped now on first publish); a draft
// leaves any existing published_at untouched, so unpublish then republish keeps
// the original date.
export async function savePost(handle: string, post: Post): Promise<Post> {
  if (!db) throw new Error("savePost requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  // Never taken from the client Post: an update keeps the stored folder and
  // an insert lands in the folder matching the post's type (moves are a
  // store-level concern).
  const insertFolder = await folderForPostType(blogId, post.type);
  // Notes and bookmarks are always unlisted: no save path may publish them.
  const status =
    post.type === "note" || post.type === "bookmark" ? "draft" : post.status;
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
    status,
    pinned: post.pinned ?? false,
    updatedAt: new Date(),
  };
  const publishedAt =
    status === "published"
      ? post.date
        ? new Date(post.date)
        : sql`COALESCE(${posts.publishedAt}, now())`
      : undefined;
  // A draft omits published_at from the update so an existing publish date lives.
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
    if (inserted[0]) return inserted[0];
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
    if (inserted[0]) break;
    const settled = await getOwnedBlog(user.sub);
    if (settled) return settled; // another request created this owner's blog
    // otherwise the handle collided with a different owner; try another handle
  }

  const created = await getOwnedBlog(user.sub);
  if (!created) throw new Error("failed to provision a blog");
  return { ...created, username: created.username ?? username };
}
