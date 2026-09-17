// How many times each main read talks to the database.
//
// Against local Postgres a round trip is a fraction of a millisecond, so a
// page can make fifty and still feel instant here while taking seconds in the
// Mac app, where every one is an HTTPS request to another continent. The count
// is what a page's speed is made of, and it is invisible unless something
// counts it. This prints the count for the reads a person waits on, so "it
// feels slow" can be answered with a number.
//
// A budget for the Home is enforced in
// src/lib/reading/__tests__/home-query-budget.db.test.ts. This script is the
// wider look, for finding the next one.
//
//   npx tsx scripts/query-budget.ts
//   npx tsx scripts/query-budget.ts --handle showcase
//
// Local Postgres only: it reads a real workspace and never writes.

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

const handleArg = process.argv.indexOf("--handle");
const HANDLE = handleArg > 0 ? process.argv[handleArg + 1] : undefined;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not configured.");
    process.exit(2);
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    console.error("Local Postgres only. This reads a workspace and is not for the production database.");
    process.exit(2);
  }
  const { db, queriesIssued, closeDatabaseConnections } = await import("../src/lib/db/client");
  const schema = await import("../src/lib/db/schema");
  const store = await import("../src/lib/store");
  const home = await import("../src/lib/reading/home.server");
  const overview = await import("../src/lib/reading/overview.server");
  const list = await import("../src/lib/reading/list.server");
  const { desc, eq, isNull, sql } = await import("drizzle-orm");
  if (!db) throw new Error("no database");

  // The workspace with the most feed items, which is the one worth measuring.
  const candidates = await db
    .select({ handle: schema.blogs.handle, owner: schema.blogs.ownerId, items: sql<number>`count(${schema.posts.id})::int` })
    .from(schema.blogs)
    .leftJoin(schema.posts, eq(schema.posts.blogId, schema.blogs.id))
    .where(isNull(schema.blogs.deletedAt))
    .groupBy(schema.blogs.handle, schema.blogs.ownerId)
    .orderBy(desc(sql`count(${schema.posts.id})`))
    .limit(5);
  const chosen = HANDLE ? candidates.find((row) => row.handle === HANDLE) : candidates[0];
  if (!chosen) {
    console.error(HANDLE ? `No workspace @${HANDLE}.` : "No workspaces.");
    process.exit(2);
  }
  const handle = chosen.handle;
  const user = { sub: `budget:${handle}`, userId: chosen.owner };
  console.log(`@${handle}, ${chosen.items} items\n`);
  console.log("  read                            round trips");
  console.log("  ------------------------------  -----------");

  // Warm once and measure the second call: the first call of a process pays
  // for module loading and pool setup, which nobody waits on twice.
  const spent = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
      const before = queriesIssued();
      await run();
      console.log(`  ${label.padEnd(30)}  ${String(queriesIssued() - before).padStart(11)}`);
    } catch (error) {
      console.log(`  ${label.padEnd(30)}  ${(error instanceof Error ? error.message : String(error)).slice(0, 40)}`);
    }
  };

  await spent("Home, For You", () => home.readingHome({ handle, user }));
  await spent("Home, a channel", () => home.readingHome({ handle, user, topic: "channel:Technology" }));
  await spent("Home, Latest", () => home.readingHome({ handle, user, mode: "latest" }));
  await spent("Reading overview", () => overview.readingOverview({ handle, user }));
  await spent("Reading list, one page", () =>
    list.listReadingItems({
      handle,
      user,
      scope: { folderPath: "bookmarks", includeDescendants: true, state: "all", dateBasis: "published" },
      limit: 40,
    }),
  );
  await spent("Folders", () => store.getFolders(handle));
  await spent("Folder counts", () => store.getFolderCounts(handle));

  console.log("\n  A number that grows is usually the same question asked twice.");
  console.log("  src/lib/request-scope.ts holds one answer per read.\n");
  await closeDatabaseConnections();
  process.exit(0);
}

void main();
