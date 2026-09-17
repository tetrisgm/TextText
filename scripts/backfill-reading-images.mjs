#!/usr/bin/env node
// Give the items already in the workspace a picture.
//
// The tick asks for a handful per pass, which is right for items arriving now
// and far too slow for a workspace that already holds hundreds. This drains
// the backlog in one go, at the same bounds: one request per item, the page's
// declared social card only, and a mark written whether or not one was found
// so nothing is ever asked twice.
//
//   node --env-file=.env.local --import tsx scripts/backfill-reading-images.mjs [handle]
import pkg from "@next/env";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL is not configured; nothing to backfill.");
  process.exit(0);
}

const { db } = await import("../src/lib/db/client.ts");
const { blogs } = await import("../src/lib/db/schema.ts");
const { enrichPendingImages } = await import("../src/lib/reading/images.server.ts");
const { eq } = await import("drizzle-orm");

const handle = process.argv[2] ?? null;
const rows = handle
  ? await db.select({ id: blogs.id, handle: blogs.handle }).from(blogs).where(eq(blogs.handle, handle))
  : await db.select({ id: blogs.id, handle: blogs.handle }).from(blogs);
if (rows.length === 0) {
  console.log(handle ? `No workspace named ${handle}.` : "No workspaces.");
  process.exit(0);
}

for (const blog of rows) {
  let looked = 0;
  let found = 0;
  for (let pass = 0; pass < 400; pass += 1) {
    const result = await enrichPendingImages(blog.id);
    looked += result.looked;
    found += result.found;
    if (!result.remaining || result.looked === 0) break;
    if (pass % 10 === 9) console.log(`  ${blog.handle}: ${found} of ${looked} so far`);
  }
  console.log(`${blog.handle}: looked at ${looked}, found ${found}`);
}
process.exit(0);
