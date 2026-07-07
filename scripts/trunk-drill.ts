// Live drill for the 2026-07-07 trunk: creates a throwaway workspace, then
// exercises subfolders, the change cursor, captures, and shares end to end
// against the real database. Run with `npx tsx scripts/trunk-drill.ts`;
// clean up with `npx tsx scripts/trunk-drill.ts cleanup`.

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true, { info() {}, error() {} } as never);

const SUB = "dev:trunk-drill@test.write";
const EMAIL_B = "drill-collab@test.write";

async function main() {
  const store = await import("../src/lib/store");
  const tokens = await import("../src/lib/api-tokens");
  const shares = await import("../src/lib/shares");
  const cursorLib = await import("../src/lib/sync-cursor");

  if (process.argv[2] === "cleanup") {
    const { db } = await import("../src/lib/db/client");
    const { blogs, posts, folders, users, apiTokens, collaborators, actionAudit } =
      await import("../src/lib/db/schema");
    const { eq, inArray } = await import("drizzle-orm");
    if (!db) throw new Error("no db");
    for (const sub of [SUB, `dev:${EMAIL_B}`]) {
      const u = await db.select().from(users).where(eq(users.appleSub, sub));
      if (!u[0]) continue;
      const bs = await db.select().from(blogs).where(eq(blogs.ownerId, u[0].id));
      const ids = bs.map((b) => b.id);
      if (ids.length) {
        const ps = await db.select().from(posts).where(inArray(posts.blogId, ids));
        if (ps.length) {
          await db.delete(collaborators).where(
            inArray(collaborators.scopeId, ps.map((p) => p.id)),
          );
        }
        await db.delete(posts).where(inArray(posts.blogId, ids));
        await db.delete(folders).where(inArray(folders.blogId, ids));
        await db.delete(blogs).where(inArray(blogs.id, ids));
      }
      await db.delete(apiTokens).where(eq(apiTokens.userId, u[0].id));
      await db.delete(actionAudit).where(eq(actionAudit.actorUserId, u[0].id));
      await db.delete(users).where(eq(users.id, u[0].id));
    }
    console.log("cleaned");
    return;
  }

  const blog = await store.ensureOwnerBlog({
    sub: SUB,
    name: "Trunk Drill",
    email: "trunk-drill@test.write",
  });
  const draft = await store.createDraft(blog.handle, "article");
  const post = await store.savePost(blog.handle, {
    ...draft,
    title: "Drill post",
    body: "hello",
  });

  const userId = await store.getUserIdBySub(SUB);
  const token = await tokens.createApiToken(userId!, "drill-token");

  // 1. Subfolders: create nested, list, verify paths + mode inheritance.
  const sub1 = await store.createSubfolder(blog.handle, "blog", "Ideas");
  const sub2 = await store.createSubfolder(blog.handle, sub1.path, "Deep Ideas");
  const collision = await store.createSubfolder(blog.handle, "blog", "Ideas!");
  const noteSub = await store.createSubfolder(blog.handle, "notes", "Work");
  const all = await store.getFolders(blog.handle);
  console.log("FOLDERS", JSON.stringify(all.map((f) => `${f.path}:${f.mode}`)));
  if (sub2.path !== "blog/ideas/deep-ideas") throw new Error("nested path wrong");
  if (collision.path === sub1.path) throw new Error("collision not suffixed");
  if (noteSub.mode !== "notes") throw new Error("mode not inherited");

  // Depth cap: blog/ideas/deep-ideas/x ok (4), then one more must fail.
  const four = await store.createSubfolder(blog.handle, sub2.path, "Four");
  let capped = false;
  try {
    await store.createSubfolder(blog.handle, four.path, "Five");
  } catch {
    capped = true;
  }
  if (!capped) throw new Error("depth cap missing");

  // 2. Change cursor: moves on edit.
  const c1 = await cursorLib.workspaceChangeCursor(blog.handle);
  await new Promise((r) => setTimeout(r, 30));
  await store.savePost(blog.handle, { ...post, title: "Drill post edited" });
  const c2 = await cursorLib.workspaceChangeCursor(blog.handle);
  if (!(c2 > c1)) throw new Error(`cursor did not advance: ${c1} -> ${c2}`);

  // 3. Shares: invite by email, unbound -> role via email match, binding.
  await shares.invitePostShare({
    postId: post.id!,
    email: EMAIL_B,
    role: "editor",
    invitedBySub: SUB,
  });
  const listed = await shares.listPostShares(post.id!);
  if (listed.length !== 1 || listed[0].accepted) throw new Error("invite wrong");

  // Session B before any users row exists: email match, no binding yet.
  const roleUnbound = await shares.postShareRoleFor(
    { sub: `dev:${EMAIL_B}`, email: EMAIL_B },
    post.id!,
  );
  if (roleUnbound !== "editor") throw new Error("email match failed");

  // B signs in and touches a workspace -> users row -> binding on next check.
  await store.ensureOwnerBlog({ sub: `dev:${EMAIL_B}`, name: "B", email: EMAIL_B });
  const roleBinding = await shares.postShareRoleFor(
    { sub: `dev:${EMAIL_B}`, email: EMAIL_B },
    post.id!,
  );
  const afterBind = await shares.listPostShares(post.id!);
  if (roleBinding !== "editor" || !afterBind[0].accepted) {
    throw new Error("binding failed");
  }

  // A DIFFERENT identity with a different email must get nothing.
  const roleStranger = await shares.postShareRoleFor(
    { sub: "dev:stranger@test.write", email: "stranger@test.write" },
    post.id!,
  );
  if (roleStranger !== null) throw new Error("stranger got access");

  // Shared-with-me for B.
  const mine = await shares.getSharedPostsForUser({
    sub: `dev:${EMAIL_B}`,
    email: EMAIL_B,
  });
  if (mine.length !== 1 || mine[0].title !== "Drill post edited") {
    throw new Error("shared-with-me wrong");
  }

  // 4. Captures: bookmark -> pending -> agent PUT path exercised via store.
  const bDraft = await store.createDraft(blog.handle, "bookmark");
  const bm = await store.savePost(blog.handle, {
    ...bDraft,
    title: "example.com",
    links: [{ label: "example.com", href: "https://example.com/" }],
  });
  await store.markCapturePending(blog.handle, bm.id!, "https://example.com/");
  const pending = await store.listPendingCaptures(blog.handle);
  if (!pending.find((p) => p.id === bm.id)) throw new Error("not pending");
  await store.saveBookmarkCapture(
    blog.handle,
    bm.id!,
    { url: "https://example.com/", title: "Example", capturedBy: "drill" },
    { readableMarkdown: "# Example\n\nBody text." },
  );
  const done = await store.getPostById(blog.handle, bm.id!);
  if (done?.captureStatus !== "captured" || !done.body.includes("Body text")) {
    throw new Error("capture save wrong");
  }

  console.log(
    JSON.stringify({
      ok: true,
      handle: blog.handle,
      postId: post.id,
      token: token.raw,
    }),
  );
}

main().catch((error) => {
  console.error("DRILL FAILED:", error.message);
  process.exit(1);
});
