// Content access for the app. This is the ONLY content access point: routes and
// the editor go through here, never src/lib/demo.ts directly. With DATABASE_URL
// unset the app serves the demo seed so it runs with zero setup; with a database
// configured the same functions read and write Postgres (Drizzle + Neon).

import { and, desc, eq, sql } from "drizzle-orm";
import type { Blog, Post } from "./content";
import { db } from "./db/client";
import { blogs, posts, users } from "./db/schema";
import { DEMO_BLOG, DEMO_POSTS } from "./demo";

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
// Updates the row by id when the post already exists, so a slug edit renames in
// place; otherwise inserts, upserting on the (blog, slug) unique index. A first
// publish stamps published_at; re-saving a published post keeps the original.
export async function savePost(handle: string, post: Post): Promise<Post> {
  if (!db) throw new Error("savePost requires DATABASE_URL");
  const blogId = await blogIdFor(handle);
  const fields = {
    title: post.title,
    kicker: post.kicker ?? null,
    accent: post.accent ?? null,
    cover: post.cover ?? null,
    coverCaption: post.coverCaption ?? null,
    body: post.body,
    status: post.status,
    updatedAt: new Date(),
  };
  const keepOrStampPublished =
    post.status === "published"
      ? sql`COALESCE(${posts.publishedAt}, now())`
      : null;

  if (post.id) {
    const updated = await db
      .update(posts)
      .set({ ...fields, slug: post.slug, publishedAt: keepOrStampPublished })
      .where(eq(posts.id, post.id))
      .returning();
    if (updated[0]) return mapPost(updated[0]);
  }

  const inserted = await db
    .insert(posts)
    .values({
      blogId,
      slug: post.slug,
      ...fields,
      publishedAt: post.status === "published" ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [posts.blogId, posts.slug],
      set: { ...fields, publishedAt: keepOrStampPublished },
    })
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
