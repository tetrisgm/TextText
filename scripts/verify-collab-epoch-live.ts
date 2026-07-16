// Live proof of the co-editing GENERATION logic (hole 2) against the real DB:
// the fenced append, the quiescence+staleness-gated upsert-CAS retire, the
// materialization marker, and that a retire does not reseed-loop. Stands up an
// isolated scratch post, exercises the raw SQL in src/lib/collab.ts, asserts, and
// tears down in a finally.
//
//   DATABASE_URL=... npx tsx scripts/verify-collab-epoch-live.ts

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { blogs, collabState, collabUpdates, posts, users } from "@/lib/db/schema";
import { ensureWorkspaceFolders } from "@/lib/store";
import {
  appendCollabUpdate,
  getCollabEpoch,
  markCollabMaterialized,
  retireStaleCollabEpoch,
} from "@/lib/collab";

const STAMP = Date.now().toString(36);
const HANDLE = `scratch-epoch-${STAMP}`;

const pass: string[] = [];
const fail: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  (ok ? pass : fail).push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

async function main() {
  if (!db) throw new Error("DATABASE_URL required");
  let userId = "";
  let postId = "";
  try {
    const [u] = await db
      .insert(users)
      .values({ appleSub: HANDLE, username: HANDLE, name: "Epoch Verify" })
      .returning({ id: users.id });
    userId = u.id;
    const [b] = await db
      .insert(blogs)
      .values({ handle: HANDLE, name: "Epoch Verify", ownerId: userId })
      .returning({ id: blogs.id });
    await ensureWorkspaceFolders(b.id);
    const [p] = await db
      .insert(posts)
      .values({ blogId: b.id, type: "article", title: "T", slug: `t-${STAMP}`, body: "B", status: "draft" })
      .returning({ id: posts.id });
    postId = p.id;
    console.log(`scratch post ${postId} ready\n`);

    // Fresh post: epoch 0.
    check("new post starts at epoch 0", (await getCollabEpoch(postId)) === 0);

    // Fenced append: epoch 0 (current) lands; epoch 1 (stale) is retired.
    const a0 = await appendCollabUpdate(postId, "AAAA", 0);
    check("append fenced on the current epoch lands", "seq" in a0, JSON.stringify(a0));
    const a1 = await appendCollabUpdate(postId, "BBBB", 1);
    check("append fenced on a stale epoch is retired", "retired" in a1, JSON.stringify(a1));

    // Materialize marks provenance without bumping the epoch.
    await markCollabMaterialized(postId, 50);
    check("materialize does not change the epoch", (await getCollabEpoch(postId)) === 0);

    // Not stale yet (materialized_revision 50 == postRevision 50): no retire.
    const notStale = await retireStaleCollabEpoch(postId, 50);
    check("consistent post is not retired", notStale === false);

    // Age the log so it is quiescent (past COLLAB_SETTLE_MS), then an external
    // write (postRevision 100 > materialized 50) with no co-editors -> retire.
    await db
      .update(collabUpdates)
      .set({ createdAt: new Date(Date.now() - 120_000) })
      .where(eq(collabUpdates.postId, postId));
    const retired = await retireStaleCollabEpoch(postId, 100);
    const [state] = await db
      .select()
      .from(collabState)
      .where(eq(collabState.postId, postId));
    check(
      "stale + quiescent + idle post is retired (epoch bumps, provenance set)",
      retired === true && state?.epoch === 1 && state?.materializedRevision === 100,
      `epoch=${state?.epoch} matRev=${state?.materializedRevision}`,
    );

    // After retire: the old epoch is fenced out, the new epoch accepts.
    const oldEpochAppend = await appendCollabUpdate(postId, "CCCC", 0);
    check("append on the retired epoch is rejected", "retired" in oldEpochAppend);
    const newEpochAppend = await appendCollabUpdate(postId, "DDDD", 1);
    check("append on the new epoch lands", "seq" in newEpochAppend);

    // No reseed loop: the retire set materialized_revision=100, so a second
    // open at the same revision is NOT stale.
    await db
      .update(collabUpdates)
      .set({ createdAt: new Date(Date.now() - 120_000) })
      .where(eq(collabUpdates.postId, postId));
    const secondRetire = await retireStaleCollabEpoch(postId, 100);
    const [state2] = await db
      .select()
      .from(collabState)
      .where(eq(collabState.postId, postId));
    check(
      "a consistent reopen does not retire again (no reseed loop)",
      secondRetire === false && state2?.epoch === 1,
      `retired=${secondRetire} epoch=${state2?.epoch}`,
    );
  } finally {
    if (postId) {
      await db.delete(collabUpdates).where(eq(collabUpdates.postId, postId)).catch(() => {});
      await db.delete(collabState).where(eq(collabState.postId, postId)).catch(() => {});
      await db.delete(posts).where(eq(posts.id, postId)).catch(() => {});
    }
    if (userId) {
      const [b] = await db.select({ id: blogs.id }).from(blogs).where(eq(blogs.ownerId, userId));
      if (b) {
        await db.delete(posts).where(eq(posts.blogId, b.id)).catch(() => {});
        // folders left by ensureWorkspaceFolders
        await db.execute(sql`DELETE FROM folders WHERE blog_id = ${b.id}::uuid`).catch(() => {});
        await db.delete(blogs).where(eq(blogs.id, b.id)).catch(() => {});
      }
      await db.delete(users).where(eq(users.id, userId)).catch(() => {});
    }
    console.log("\nscratch post torn down.");
  }

  console.log(`\n==== ${pass.length} passed, ${fail.length} failed ====`);
  if (fail.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
