/**
 * Finishes account deletions whose purge did not complete.
 *
 * A deletion is CLOSE then PURGE. CLOSE is atomic, so an account is always
 * fully closed or not closed at all. PURGE is a resumable sequence, and a
 * function timeout partway through leaves the tombstone open with rows still
 * owed. Signing in with the same identity resumes it automatically; this
 * command is for the accounts that never come back.
 *
 * A HUMAN RUNS THIS. It must never be wrapped in a launchd job, cron entry, CI
 * schedule, watcher or git hook, and no such trigger may be installed. Deleting
 * data on a timer is exactly the class of thing the project contract forbids.
 *
 *   npx tsx scripts/finish-pending-account-deletions.ts
 *   npx tsx scripts/finish-pending-account-deletions.ts --list
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

const listOnly = process.argv.includes("--list");

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL is not configured; nothing to do.");
    return;
  }
  const { listPendingAccountTombstones } = await import("@/lib/store");
  const pending = await listPendingAccountTombstones();
  if (pending.length === 0) {
    console.log("No account deletions are pending.");
    return;
  }

  console.log(`${pending.length} account deletion(s) pending:`);
  for (const tombstone of pending) {
    console.log(
      `  handle=${tombstone.handle ?? "-"} username=${tombstone.username ?? "-"} subHash=${tombstone.subHash.slice(0, 12)}...`,
    );
  }
  if (listOnly) return;

  // resumeAccountDeletion takes the sub, which is exactly what a tombstone does
  // not keep: it stores a one-way hash so a deleted person's identifier is not
  // sitting in the table. Purge from the recorded ids instead.
  const { purgeAccount } = await import("@/lib/account-deletion");
  const { completeAccountTombstone } = await import("@/lib/store");
  let finished = 0;
  for (const tombstone of pending) {
    if (!tombstone.userId || !tombstone.blogId || !tombstone.handle) {
      await completeAccountTombstone(tombstone.subHash);
      finished += 1;
      continue;
    }
    try {
      await purgeAccount({
        userId: tombstone.userId,
        // Only used for the poll-vote key shape and the Apple revoke, neither of
        // which is recoverable from a hash. The userId form still matches.
        sub: "",
        email: null,
        username: tombstone.username,
        blogId: tombstone.blogId,
        handle: tombstone.handle,
        workspaceName: "",
        documents: 0,
        publishedDocuments: 0,
        collaborators: 0,
        apiTokens: 0,
        hasCloudAiKey: false,
      });
      finished += 1;
      console.log(`  finished ${tombstone.handle}`);
    } catch (error) {
      console.error(`  FAILED ${tombstone.handle}`, error);
    }
  }
  console.log(`Finished ${finished} of ${pending.length}.`);
}

await main();
