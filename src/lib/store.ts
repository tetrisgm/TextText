// Content access for the app. This is the ONLY content access point: routes and
// the editor go through here, never src/lib/demo.ts directly. With DATABASE_URL
// unset the app serves the demo seed so it runs with zero setup; with a database
// configured the same functions read and write Postgres (Drizzle + Neon).

import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import type {
  Blog,
  BlogCardStyle,
  BlogHomeLayout,
  Post,
  PostType,
} from "./content";
import { db } from "./db/client";
import { blogs, posts, users } from "./db/schema";
import { DEMO_BLOG, DEMO_POSTS } from "./demo";
import { RESERVED_HANDLES, TENANT_HANDLE_RE } from "./tenants";

type PostRow = typeof posts.$inferSelect;
type BlogRow = {
  handle: string;
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

const DEFAULT_ANONYMOUS_BLOG_NAME = "Untitled blog";
const DEFAULT_CARD_STYLE: BlogCardStyle = "cover";
const DEFAULT_HOME_LAYOUT: BlogHomeLayout = "cards";

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
    gallery: row.gallery ?? undefined,
    links: row.links ?? undefined,
    videoUrl: row.videoUrl ?? undefined,
    venue: row.venue ?? undefined,
    duration: row.duration ?? undefined,
    body: row.body,
    date: toISODate(row.publishedAt ?? row.createdAt),
    status: row.status,
    pinned: row.pinned,
  };
}

function mapBlog(row: BlogRow): Blog {
  return {
    handle: row.handle,
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
    .where(eq(blogs.handle, handle))
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
        ? and(eq(blogs.handle, handle), eq(posts.status, "published"))
        : eq(blogs.handle, handle),
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
    .where(and(eq(blogs.handle, handle), eq(posts.slug, slug)))
    .limit(1);
  return rows[0] ? mapPost(rows[0].posts) : null;
}

async function blogIdFor(handle: string): Promise<string> {
  const rows = await db!
    .select({ id: blogs.id })
    .from(blogs)
    .where(eq(blogs.handle, handle))
    .limit(1);
  const id = rows[0]?.id;
  if (!id) throw new Error(`unknown blog "${handle}"`);
  return id;
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
    .where(eq(blogs.handle, handle))
    .limit(1);
  return rows[0] ?? null;
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
    .where(and(eq(blogs.handle, handle), eq(users.appleSub, sub)))
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
    .where(and(eq(blogs.handle, handle), eq(posts.id, id)))
    .limit(1);
  return rows[0] ? mapPost(rows[0].posts) : null;
}

export async function deletePost(handle: string, id: string): Promise<void> {
  if (!db) throw new Error("deletePost requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  await db.delete(posts).where(and(eq(posts.id, id), eq(posts.blogId, blogId)));
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
    .set({ pinned })
    .where(and(eq(posts.id, id), eq(posts.blogId, blogId)))
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
  const base = {
    type: post.type,
    title: post.title,
    excerpt: post.excerpt ?? null,
    accent: post.accent ?? null,
    cover: post.cover ?? null,
    coverCaption: post.coverCaption ?? null,
    gallery: post.gallery ?? null,
    links: post.links ?? null,
    videoUrl: post.videoUrl ?? null,
    venue: post.venue ?? null,
    duration: post.duration ?? null,
    body: post.body,
    status: post.status,
    pinned: post.pinned ?? false,
    updatedAt: new Date(),
  };
  const publishedAt =
    post.status === "published"
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
        .where(and(eq(posts.id, post.id), eq(posts.blogId, blogId)))
        .returning();
      if (updated[0]) return mapPost(updated[0]);
    }

    const inserted = await db
      .insert(posts)
      .values({
        blogId,
        slug: post.slug,
        ...base,
        publishedAt:
          post.status === "published"
            ? post.date
              ? new Date(post.date)
              : new Date()
            : null,
      })
      .onConflictDoUpdate({ target: [posts.blogId, posts.slug], set })
      .returning();
    return mapPost(inserted[0]);
  } catch (error) {
    if (isPostsBlogSlugConflict(error)) throw new Error("That URL is already used");
    throw error;
  }
}

// Create an empty draft and return it (with its new id), for the editor's
// "New draft" action. Requires a database.
export async function createDraft(
  handle: string,
  type: PostType = "article",
): Promise<Post> {
  if (!db) throw new Error("createDraft requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  const slug = `untitled-${Date.now().toString(36)}`;
  const inserted = await db
    .insert(posts)
    .values({
      blogId,
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
    .where(eq(users.appleSub, sub))
    .orderBy(asc(blogs.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return mapBlog(row);
}

async function upsertUser(user: StoreUser): Promise<{ id: string; name: string | null }> {
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
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.appleSub, user.sub))
      .limit(1)
  )[0];
  if (!row) throw new Error("failed to resolve user");
  return row;
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
  return value === "timeline" ? "timeline" : DEFAULT_HOME_LAYOUT;
}

function cleanBlogCardStyle(value: unknown): BlogCardStyle {
  if (value === "cover" || value === "minimal") return value;
  throw new Error("Card style must be Cover or Minimal");
}

function cleanBlogHomeLayout(value: unknown): BlogHomeLayout {
  if (value === "cards" || value === "timeline") return value;
  throw new Error("Home layout must be Cards or Timeline");
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
      .where(eq(blogs.handle, handle))
      .orderBy(asc(blogs.createdAt))
      .limit(1)
  )[0];
  if (!existing) throw new Error("Blog not found");

  const set: Partial<typeof blogs.$inferInsert> = {};

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

  if (Object.keys(set).length === 0) return mapBlog(existing);

  try {
    const updated = await db
      .update(blogs)
      .set(set)
      .where(eq(blogs.id, existing.id))
      .returning();
    const row = updated[0];
    if (!row) throw new Error("Blog not found");
    return mapBlog({ ...row, author: existing.author });
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
      .where(eq(users.appleSub, sub))
      .orderBy(asc(blogs.createdAt))
      .limit(1)
  )[0];
  if (!owned) throw new Error("No blog found for this user");
  return updateBlogByHandle(owned.handle, patch, { allowHandleChange: true });
}

export async function createAnonymousBlogRecord(
  editTokenHash: string,
  seed: string,
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

  try {
    const updated = await db
      .update(blogs)
      .set({ ownerId: owner.id, editTokenHash: null })
      .where(and(eq(blogs.id, target.id), isNull(blogs.ownerId)))
      .returning();
    const row = updated[0];
    if (!row) throw new Error("This blog is already claimed");
    return mapBlog({ ...row, author: owner.name });
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
  if (existing) return existing;
  const name = user.name ? `${user.name}'s blog` : "My blog";
  const seed = user.email?.split("@")[0] || user.name || "blog";

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
  return created;
}
