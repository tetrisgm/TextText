/**
 * Merges one account into another, so a person who signed in two different ways
 * and ended up with two workspaces can have one.
 *
 * Everything the source owns moves to the target: documents, folders, the
 * identities that sign them in, their API tokens and OAuth grants. The source's
 * public addresses are then held by a tombstone, exactly as a deletion holds
 * them, so links people already followed cannot be claimed by a stranger.
 *
 * REPORTS BY DEFAULT. Nothing is written without --apply, and the report is the
 * plan: read it before running it.
 *
 * Deliberately NOT automatic and never scheduled. Merging is irreversible and
 * the direction is a judgement about which workspace is the real one.
 *
 *   npx tsx scripts/merge-accounts.ts --from @blog-writer --into @leshokunin
 *   npx tsx scripts/merge-accounts.ts --from @blog-writer --into @leshokunin --apply
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const fromName = (arg("--from") ?? "").replace(/^@/, "");
const intoName = (arg("--into") ?? "").replace(/^@/, "");
const apply = process.argv.includes("--apply");

if (!fromName || !intoName) {
  console.error("usage: merge-accounts.ts --from @source --into @target [--apply]");
  process.exit(64);
}
if (fromName === intoName) {
  console.error("Source and target are the same account.");
  process.exit(64);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL is not configured.");
    return;
  }
  const pg = (await import("pg")).default;
  const url = process.env.DATABASE_URL;
  const c = new pg.Client({
    connectionString: url,
    ssl: url.includes(".neon.tech") ? { rejectUnauthorized: true } : undefined,
  });
  await c.connect();

  const person = async (username: string) => {
    const { rows } = await c.query(
      `SELECT u.id, u.username, u.email, u.apple_sub, b.id AS blog_id, b.handle,
              (SELECT count(*)::int FROM posts p WHERE p.blog_id = b.id) AS docs
         FROM users u LEFT JOIN blogs b ON b.owner_id = u.id
        WHERE u.username = $1`,
      [username],
    );
    return rows[0];
  };

  const from = await person(fromName);
  const into = await person(intoName);
  if (!from) throw new Error(`No account @${fromName}`);
  if (!into) throw new Error(`No account @${intoName}`);
  if (!into.blog_id) throw new Error(`@${intoName} owns no workspace to merge into`);

  const idsOf = async (userId: string) =>
    (await c.query(`SELECT provider, subject FROM user_identities WHERE user_id = $1`, [userId]))
      .rows;
  const fromIdentities = await idsOf(from.id);
  const intoIdentities = await idsOf(into.id);
  const clash = fromIdentities.filter((f) =>
    intoIdentities.some((t) => t.provider === f.provider),
  );

  console.log(`\nMERGE @${fromName} -> @${intoName}${apply ? "  (APPLYING)" : "  (report only)"}`);
  console.log(`  source  @${from.username}  handle=${from.handle ?? "-"}  documents=${from.docs ?? 0}`);
  console.log(`  target  @${into.username}  handle=${into.handle ?? "-"}  documents=${into.docs ?? 0}`);
  console.log(`  source signs in with: ${fromIdentities.map((i) => i.provider).join(", ") || "nothing"}`);
  console.log(`  target signs in with: ${intoIdentities.map((i) => i.provider).join(", ") || "nothing"}`);
  if (clash.length) {
    console.error(
      `\nRefusing: both accounts already sign in with ${clash.map((c2) => c2.provider).join(", ")}.` +
        `\nOne provider cannot reach two accounts, and picking a winner here would silently` +
        `\ndetach a way in that somebody is using. Resolve it deliberately first.`,
    );
    await c.end();
    process.exitCode = 1;
    return;
  }

  console.log("\nPLAN");
  console.log(`  1. move ${from.docs ?? 0} documents and their folders to ${into.handle}`);
  console.log(`  2. move ${fromIdentities.length} identity row(s), so those providers sign in to @${intoName}`);
  console.log(`  3. move API tokens and OAuth grants`);
  console.log(`  4. reassign the source's audit rows to @${intoName}, keeping the history`);
  console.log(`  5. hold @${fromName} and /t/${from.handle} with a tombstone so nobody can take them`);
  console.log(`  6. delete the emptied source workspace and user`);

  if (!apply) {
    console.log("\nNothing written. Re-run with --apply to perform it.\n");
    await c.end();
    return;
  }

  // Folders first: posts reference them, and both tables are keyed by blog.
  await c.query(`UPDATE folders SET blog_id = $1 WHERE blog_id = $2`, [into.blog_id, from.blog_id]);
  await c.query(`UPDATE posts SET blog_id = $1 WHERE blog_id = $2`, [into.blog_id, from.blog_id]);
  await c.query(`UPDATE idempotency_keys SET blog_id = $1 WHERE blog_id = $2`, [into.blog_id, from.blog_id]);
  // The identities are the point of the whole exercise.
  await c.query(`UPDATE user_identities SET user_id = $1 WHERE user_id = $2`, [into.id, from.id]);
  await c.query(`UPDATE api_tokens SET user_id = $1 WHERE user_id = $2`, [into.id, from.id]);
  await c.query(`UPDATE oauth_refresh_token_families SET user_id = $1 WHERE user_id = $2`, [into.id, from.id]);
  await c.query(`UPDATE oauth_authorization_codes SET user_id = $1 WHERE user_id = $2`, [into.id, from.id]);
  await c.query(`UPDATE app_health_reports SET user_id = $1 WHERE user_id = $2`, [into.id, from.id]);
  await c.query(`UPDATE device_links SET approved_by_user_id = $1 WHERE approved_by_user_id = $2`, [into.id, from.id]);
  // Reassigned rather than nulled: this is the same person, so the history is
  // still theirs. A deletion nulls; a merge keeps the thread.
  await c.query(`UPDATE action_audit SET actor_user_id = $1 WHERE actor_user_id = $2`, [into.id, from.id]);
  await c.query(`UPDATE collaborators SET user_id = $1 WHERE user_id = $2`, [into.id, from.id]);
  await c.query(`UPDATE collaborators SET invited_by_id = $1 WHERE invited_by_id = $2`, [into.id, from.id]);
  await c.query(`UPDATE document_capability_links SET created_by_id = $1 WHERE created_by_id = $2`, [into.id, from.id]);
  await c.query(`UPDATE document_templates SET created_by_id = $1 WHERE created_by_id = $2`, [into.id, from.id]);

  const { createHash } = await import("node:crypto");
  // A synthetic hash, NOT the source's subject.
  //
  // A tombstone means two things at once: hold the released names, and refuse
  // the subject so a stale session cannot resurrect the account. Only the first
  // applies to a merge. The source's subjects are alive and now belong to the
  // target, so hashing one here would make upsertUser throw AccountDeletedError
  // the next time that provider signed in, locking the person out of the
  // account we just merged everything into.
  const subHash = createHash("sha256").update(`merged:${from.id}`).digest("hex");
  await c.query(
    `INSERT INTO deleted_accounts (sub_hash, user_id, blog_id, username, handle, completed_at)
     VALUES ($1, NULL, NULL, $2, $3, now())
     ON CONFLICT (sub_hash) DO NOTHING`,
    [subHash, from.username, from.handle],
  );

  await c.query(`DELETE FROM blogs WHERE id = $1`, [from.blog_id]);
  await c.query(`DELETE FROM users WHERE id = $1`, [from.id]);

  const after = await person(intoName);
  console.log(`\nDone. @${intoName} now has ${after.docs} documents and signs in with ` +
    `${(await idsOf(into.id)).map((i) => i.provider).join(", ")}.\n`);
  await c.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
