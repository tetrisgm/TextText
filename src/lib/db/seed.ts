// Seed a fresh database with the demo blog so a DB-backed install matches the
// zero-setup demo. Run once after pushing the schema: `npm run db:seed`.
// Idempotent: re-running does not duplicate rows.

import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { blogs, posts, users } from "./schema";
import { DEMO_BLOG, DEMO_POSTS } from "../demo";
import { wordCountForMarkdown } from "../content";
import { ensureWorkspaceFolders, folderPathForPostType } from "../store";
import { normalizeTags } from "../tags";

async function main() {
  if (!db) throw new Error("db:seed requires DATABASE_URL");
  const demoUsername = DEMO_BLOG.username ?? DEMO_BLOG.handle;

  await db
    .insert(users)
    .values({
      appleSub: "demo-owner",
      name: DEMO_BLOG.author,
      username: demoUsername,
    })
    .onConflictDoUpdate({
      target: users.appleSub,
      set: {
        name: DEMO_BLOG.author,
        username: demoUsername,
      },
    });
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
      cardStyle: DEMO_BLOG.cardStyle,
      homeLayout: DEMO_BLOG.homeLayout,
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

  // The three system folders (Blog, Notes, Bookmarks); each post lands in the
  // folder matching its type.
  const workspaceFolders = await ensureWorkspaceFolders(blog.id);
  const folderIdByPath = new Map(
    workspaceFolders.map((folder) => [folder.path, folder.id]),
  );

  for (const p of DEMO_POSTS) {
    const folderId = folderIdByPath.get(folderPathForPostType(p.type));
    if (!folderId) throw new Error(`no folder for a "${p.type}" post`);
    await db
      .insert(posts)
      .values({
        blogId: blog.id,
        folderId,
        document: p.document!,
        visibility: p.visibility ?? "private",
        templateId: p.document!.presentation.template.id,
        templateVersion: p.document!.presentation.template.version,
        type: p.type,
        slug: p.slug,
        title: p.title,
        excerpt: p.excerpt ?? null,
        // preserve the accent tri-state: undefined -> null (inherit), "" stays
        // "" (explicit opt-out), a hex stays a hex.
        accent: p.accent ?? null,
        cover: p.cover ?? null,
        coverCaption: p.coverCaption ?? null,
        coverHeight: p.coverHeight ?? null,
        gallery: p.gallery ?? null,
        links: p.links ?? null,
        tags: normalizeTags(p.tags),
        videoUrl: p.videoUrl ?? null,
        venue: p.venue ?? null,
        duration: p.duration ?? null,
        body: p.body,
        wordCount: wordCountForMarkdown(p.body),
        status: p.status,
        pinned: p.pinned ?? false,
        publishedAt:
          p.status === "published" && p.date ? new Date(p.date) : null,
      })
      // The slug index is partial (deleted_at is null), so the conflict
      // target must carry the same predicate to match it.
      .onConflictDoNothing({
        target: [posts.blogId, posts.slug],
        where: sql`${posts.deletedAt} is null`,
      });
  }

  console.log(
    `Seeded blog "${DEMO_BLOG.handle}" with ${workspaceFolders.length} folders and ${DEMO_POSTS.length} posts.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
