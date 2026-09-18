// Ask every workspace whether it still agrees with itself.
//
// The simulator in concurrent-writes.db.test.ts catches a write path that can
// lose text before it ships. This is the other half: a workspace that has
// already drifted, for a reason nobody predicted, in a way nothing else would
// notice until a person opened an item and found the wrong words.
//
// It reports and repairs nothing. The first thing to know about drift is that
// it happened, and a tool that quietly fixes what it finds is one nobody
// reads.
//
//   npm run sync:check                 every workspace in the local database
//   npx tsx scripts/check-sync-consistency.ts --handle showcase
//
// Local Postgres only. It reads, and it is not for the production database.

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

const argOf = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);
  return at > 0 ? process.argv[at + 1] : undefined;
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not configured.");
    process.exit(2);
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    console.error("Local Postgres only. This reads every workspace and is not for the production database.");
    process.exit(2);
  }
  const { db, closeDatabaseConnections } = await import("../src/lib/db/client");
  const schema = await import("../src/lib/db/schema");
  const { checkWorkspaceConsistency } = await import("../src/lib/sync-consistency");
  const { and, eq, isNull } = await import("drizzle-orm");
  if (!db) throw new Error("no database");

  const wanted = argOf("--handle");
  const workspaces = await db
    .select({ id: schema.blogs.id, handle: schema.blogs.handle })
    .from(schema.blogs)
    .where(wanted ? and(eq(schema.blogs.handle, wanted), isNull(schema.blogs.deletedAt)) : isNull(schema.blogs.deletedAt));

  let drifted = 0;
  let checked = 0;
  for (const workspace of workspaces) {
    const report = await checkWorkspaceConsistency(workspace.id);
    checked += 1;
    if (report.consistent) continue;
    drifted += 1;
    console.log(`\n@${workspace.handle}  ${report.items} items`);
    for (const finding of report.findings) {
      console.log(`  ${finding.check}: ${finding.count}`);
      console.log(`    ${finding.detail}`);
      console.log(`    ${finding.examples.join(", ")}`);
    }
  }

  console.log(
    drifted === 0
      ? `\n${checked} workspace${checked === 1 ? "" : "s"} checked, every one agrees with itself.\n`
      : `\n${drifted} of ${checked} workspaces have drifted.\n`,
  );
  await closeDatabaseConnections();
  process.exit(drifted === 0 ? 0 : 1);
}

void main();
