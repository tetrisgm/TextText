// Content access for the app. This is the ONLY content access point: routes and
// the editor go through here, never src/lib/demo.ts directly. With DATABASE_URL
// unset the app serves the demo seed so it runs with zero setup; with a database
// configured the same functions read and write Postgres (Drizzle + Neon).

import { and, desc, eq, sql } from "drizzle-orm";
import type { Blog, Post } from "./content";
import { db } from "./db/client";
import { blogs, posts, users } from "./db/schema";
import { DEMO_BLOG, DEMO_POSTS } from "./demo";
import { RESERVED_HANDLES } from "./tenants";

type PostRow = typeof posts.$inferSelect;

function toISODate(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  const iso = typeof value === "string" ? value : value.toISOString();
  return iso.slice(0, 10);
}

function mapPost(row: PostRow): Post {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    kicker: row.kicker ?? undefined,
    // A null accent means "inherit the blog accent"; an empty string is an
    // explicit opt-out. Preserve the distinction (see postAccent in content.ts).
    accent: row.accent ?? undefined,
    cover: row.cover ?? undefined,
    coverCaption: row.coverCaption ?? undefined,
    body: row.body,
    date: toISODate(row.publishedAt ?? row.createdAt),
    status: row.status,
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
      author: users.name,
    })
    .from(blogs)
    .innerJoin(users, eq(blogs.ownerId, users.id))
    .where(eq(blogs.handle, handle))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    handle: row.handle,
    name: row.name,
    author: row.author ?? "",
    tagline: row.tagline ?? undefined,
    accent: row.accent ?? undefined,
    bioLine: row.bioLine ?? undefined,
  };
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
      publishedOnly ? desc(posts.publishedAt) : desc(posts.updatedAt),
      desc(posts.createdAt),
    );
  return rows.map((r) => mapPost(r.posts));
}

export async function getPosts(handle: string): Promise<Post[]> {
  if (!db) {
    if (handle !== DEMO_BLOG.handle) return [];
    return DEMO_POSTS.filter((p) => p.status === "published");
  }
  return selectPosts(handle, true);
}

export async function getAllPosts(handle: string): Promise<Post[]> {
  if (!db) {
    return handle === DEMO_BLOG.handle ? DEMO_POSTS : [];
  }
  return selectPosts(handle, false);
}

export async function getPost(
  handle: string,
  slug: string,
): Promise<Post | null> {
  if (!db) {
    if (handle !== DEMO_BLOG.handle) return null;
    return (
      DEMO_POSTS.find((p) => p.slug === slug && p.status === "published") ?? null
    );
  }
  const rows = await db
    .select()
    .from(posts)
    .innerJoin(blogs, eq(posts.blogId, blogs.id))
    .where(
      and(
        eq(blogs.handle, handle),
        eq(posts.slug, slug),
        eq(posts.status, "published"),
      ),
    )
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
    title: post.title,
    kicker: post.kicker ?? null,
    accent: post.accent ?? null,
    cover: post.cover ?? null,
    coverCaption: post.coverCaption ?? null,
    body: post.body,
    status: post.status,
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
}

// Create an empty draft and return it (with its new id), for the editor's
// "New draft" action. Requires a database.
export async function createDraft(handle: string): Promise<Post> {
  if (!db) throw new Error("createDraft requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  const slug = `untitled-${Date.now().toString(36)}`;
  const inserted = await db
    .insert(posts)
    .values({ blogId, slug, title: "Untitled", body: "", status: "draft" })
    .returning();
  return mapPost(inserted[0]);
}

function slugifyHandle(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return slug || "blog";
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
  return `${base}-${Date.now().toString(36)}`;
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
      author: users.name,
    })
    .from(blogs)
    .innerJoin(users, eq(blogs.ownerId, users.id))
    .where(eq(users.appleSub, sub))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    handle: row.handle,
    name: row.name,
    author: row.author ?? "",
    tagline: row.tagline ?? undefined,
    accent: row.accent ?? undefined,
    bioLine: row.bioLine ?? undefined,
  };
}

// Get-or-create the signed-in user's blog. Upserts the user (keyed by Apple sub;
// Apple only sends name/email on first authorization, so existing values are
// preserved on later sign-ins) and provisions a starter blog on first sign-in.
export async function ensureOwnerBlog(user: {
  sub: string;
  name?: string;
  email?: string;
}): Promise<Blog> {
  if (!db) throw new Error("ensureOwnerBlog requires DATABASE_URL");
  await db
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

  const existing = await getOwnedBlog(user.sub);
  if (existing) return existing;

  const owner = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.appleSub, user.sub))
      .limit(1)
  )[0];
  const handle = await uniqueHandle(
    user.email?.split("@")[0] || user.name || "blog",
  );
  const name = user.name ? `${user.name}'s blog` : "My blog";
  await db.insert(blogs).values({ handle, name, ownerId: owner.id });

  const created = await getOwnedBlog(user.sub);
  if (!created) throw new Error("failed to provision a blog");
  return created;
}
