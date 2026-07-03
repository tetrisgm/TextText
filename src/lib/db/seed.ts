// Seed a fresh database with the demo blog so a DB-backed install matches the
// zero-setup demo. Run once after pushing the schema: `npm run db:seed`.
// Idempotent: re-running does not duplicate rows.

import { eq } from "drizzle-orm";
import { db } from "./client";
import { blogs, posts, users } from "./schema";
import { DEMO_BLOG, DEMO_POSTS } from "../demo";

async function main() {
  if (!db) throw new Error("db:seed requires DATABASE_URL");

  await db
    .insert(users)
    .values({ appleSub: "demo-owner", name: DEMO_BLOG.author })
    .onConflictDoNothing({ target: users.appleSub });
  const owner = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.appleSub, "demo-owner"))
      .limit(1)
  )[0];

  await db
    .insert(blogs)
    .values({
      handle: DEMO_BLOG.handle,
      name: DEMO_BLOG.name,
      tagline: DEMO_BLOG.tagline ?? null,
      accent: DEMO_BLOG.accent ?? null,
      bioLine: DEMO_BLOG.bioLine ?? null,
      ownerId: owner.id,
    })
    .onConflictDoNothing({ target: blogs.handle });
  const blog = (
    await db
      .select({ id: blogs.id })
      .from(blogs)
      .where(eq(blogs.handle, DEMO_BLOG.handle))
      .limit(1)
  )[0];

  for (const p of DEMO_POSTS) {
    await db
      .insert(posts)
      .values({
        blogId: blog.id,
        slug: p.slug,
        title: p.title,
        kicker: p.kicker ?? null,
        // preserve the accent tri-state: undefined -> null (inherit), "" stays
        // "" (explicit opt-out), a hex stays a hex.
        accent: p.accent ?? null,
        cover: p.cover ?? null,
        coverCaption: p.coverCaption ?? null,
        body: p.body,
        status: p.status,
        publishedAt:
          p.status === "published" && p.date ? new Date(p.date) : null,
      })
      .onConflictDoNothing({ target: [posts.blogId, posts.slug] });
  }

  console.log(`Seeded blog "${DEMO_BLOG.handle}" with ${DEMO_POSTS.length} posts.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
