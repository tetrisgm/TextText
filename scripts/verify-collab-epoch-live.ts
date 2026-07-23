// Live proof of the canonical-document collaboration baseline against the local
// database. It covers deterministic baseline creation, epoch fencing, baseline
// rotation after an out-of-band canonical write, and materialization provenance.
// The script stands up an isolated scratch document and tears it down in a
// finally.
//
//   DATABASE_URL=... npx tsx scripts/verify-collab-epoch-live.ts

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { blogs, collabState, collabUpdates, posts, users } from "@/lib/db/schema";
import { ensureWorkspaceFolders } from "@/lib/store";
import {
  appendCollabUpdate,
  getCollabBaseline,
  getCollabEpoch,
  markCollabMaterialized,
  prepareCollabBaseline,
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

    const firstBaseline = await prepareCollabBaseline(postId);
    check(
      "new document gets a canonical baseline",
      firstBaseline?.epoch === 0 && firstBaseline.revision === 0 && Boolean(firstBaseline.update),
      JSON.stringify(firstBaseline),
    );
    check("new document starts at epoch 0", (await getCollabEpoch(postId)) === 0);
    const repeatedBaseline = await prepareCollabBaseline(postId);
    check(
      "preparing the same revision reuses its baseline",
      repeatedBaseline?.update === firstBaseline?.update &&
        repeatedBaseline?.epoch === firstBaseline?.epoch,
    );

    // Fenced append: epoch 0 (current) lands; a future epoch is rejected.
    const a0 = await appendCollabUpdate(postId, "AAAA", 0);
    check("append fenced on the current epoch lands", "seq" in a0, JSON.stringify(a0));
    const a1 = await appendCollabUpdate(postId, "BBBB", 1);
    check("append outside the current epoch is rejected", "retired" in a1, JSON.stringify(a1));

    // Materialization marks provenance without bumping the epoch.
    await markCollabMaterialized(postId, 0);
    check("materialize does not change the epoch", (await getCollabEpoch(postId)) === 0);

    // An out-of-band canonical write rotates the generation when no editor is
    // active, and makes that revision the new baseline.
    await db.update(posts).set({
      title: "Externally changed",
      body: "Canonical revision one",
      revision: 1,
      updatedAt: new Date(),
    }).where(eq(posts.id, postId));
    const rotated = await prepareCollabBaseline(postId);
    check(
      "external canonical write rotates and reseeds the baseline",
      rotated?.epoch === 1 && rotated.revision === 1 && rotated.update !== firstBaseline?.update,
      JSON.stringify(rotated),
    );

    // After rotation, the old epoch is fenced out and the new epoch accepts.
    const oldEpochAppend = await appendCollabUpdate(postId, "CCCC", 0);
    check("append on the retired epoch is rejected", "retired" in oldEpochAppend);
    const newEpochAppend = await appendCollabUpdate(postId, "DDDD", 1);
    check("append on the new epoch lands", "seq" in newEpochAppend);

    const stable = await prepareCollabBaseline(postId);
    const persisted = await getCollabBaseline(postId);
    check(
      "reopening a consistent revision does not rotate again",
      stable?.epoch === 1 && stable.update === rotated?.update &&
        persisted?.update === rotated?.update,
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
