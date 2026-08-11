/**
 * Seeds the public demo workspace.
 *
 * /@demo is the zero-setup demo, and with no DATABASE_URL the app serves it
 * straight from src/lib/demo.ts. With a database it does not: every resolver
 * goes to the tables, finds no workspace named "demo", and answers 404. So the
 * demo has never existed in production, which is what reserved-names.ts already
 * assumed was handled ("the seeded demo blog must still resolve").
 *
 * This creates it from the same seed the dev path uses, so the two cannot drift.
 *
 * The workspace is owned by a users row with no sign-in identity: apple_sub is
 * null, so no provider subject can ever match it and nobody can sign in as the
 * demo. "demo" is already reserved in both namespaces, so nobody can claim the
 * name either.
 *
 * Idempotent. It creates what is missing and leaves what exists alone, so a
 * document someone edited in the demo is not silently reverted on the next
 * release.
 *
 *   npx tsx scripts/seed-demo-workspace.ts
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL is not configured; the demo serves from the seed.");
    return;
  }

  const { DEMO_BLOG, DEMO_POSTS } = await import("../src/lib/demo");
  const { db } = await import("../src/lib/db/client");
  const { blogs, users } = await import("../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const store = await import("../src/lib/store");

  if (!db) throw new Error("no database client");

  // The owner: identity-less on purpose. /@demo resolves through
  // users.username, so the row has to exist even though nobody owns it.
  let owner = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, DEMO_BLOG.username!))
      .limit(1)
  )[0];
  if (!owner) {
    await db.insert(users).values({
      username: DEMO_BLOG.username!,
      name: DEMO_BLOG.author ?? null,
      appleSub: null,
      email: null,
    });
    owner = (
      await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, DEMO_BLOG.username!))
        .limit(1)
    )[0];
    console.log(`created demo user @${DEMO_BLOG.username}`);
  } else {
    console.log(`demo user @${DEMO_BLOG.username} already exists`);
  }
  if (!owner) throw new Error("failed to resolve the demo user");

  let blog = (
    await db
      .select({ id: blogs.id })
      .from(blogs)
      .where(eq(blogs.handle, DEMO_BLOG.handle))
      .limit(1)
  )[0];
  if (!blog) {
    await db.insert(blogs).values({
      handle: DEMO_BLOG.handle,
      ownerId: owner.id,
      name: DEMO_BLOG.name,
      tagline: DEMO_BLOG.tagline ?? null,
      accent: DEMO_BLOG.accent ?? null,
      bioLine: DEMO_BLOG.bioLine ?? null,
      cardStyle: DEMO_BLOG.cardStyle ?? null,
      homeLayout: DEMO_BLOG.homeLayout ?? null,
    });
    blog = (
      await db
        .select({ id: blogs.id })
        .from(blogs)
        .where(eq(blogs.handle, DEMO_BLOG.handle))
        .limit(1)
    )[0];
    console.log(`created demo workspace /t/${DEMO_BLOG.handle}`);
  } else {
    console.log(`demo workspace /t/${DEMO_BLOG.handle} already exists`);
  }
  if (!blog) throw new Error("failed to resolve the demo workspace");

  await store.ensureWorkspaceFolders(blog.id);

  // Through savePost, not raw inserts: it is the only content access point, it
  // writes the snapshot and its projections together, and it records the audit
  // row like any other write.
  let created = 0;
  let kept = 0;
  for (const post of DEMO_POSTS) {
    const existing = await store.getPost(DEMO_BLOG.handle, post.slug);
    if (existing) {
      kept += 1;
      continue;
    }
    await store.savePost(DEMO_BLOG.handle, post);
    created += 1;
  }

  console.log(
    `demo documents: ${created} created, ${kept} already present, ${DEMO_POSTS.length} in the seed`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
