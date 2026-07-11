// Remove the retired capture.htmlUrl field and its Vercel Blob artifact.
// Defaults to a read-only report; pass --apply to perform the cleanup.

import pkg from "@next/env";
import { neon } from "@neondatabase/serverless";
import { del } from "@vercel/blob";

const { loadEnvConfig } = pkg;
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--apply")) {
  console.error("usage: npm run db:cleanup-bookmark-html -- [--apply]");
  process.exit(64);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("db:cleanup-bookmark-html requires DATABASE_URL");
}

const sql = neon(databaseUrl);
const rows = await sql`
  select id, capture->>'htmlUrl' as html_url
  from posts
  where capture is not null and capture ? 'htmlUrl'
`;
const blobUrls = [
  ...new Set(
    rows
      .map((row) => row.html_url)
      .filter((url) => typeof url === "string" && url.trim())
      .map((url) => url.trim()),
  ),
];

console.log(
  `Found ${rows.length} capture.htmlUrl field${rows.length === 1 ? "" : "s"} and ${blobUrls.length} unique blob URL${blobUrls.length === 1 ? "" : "s"}.`,
);

if (!args.includes("--apply")) {
  console.log("Dry run only. Pass --apply to delete blobs and strip the fields.");
  process.exit(0);
}

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (blobUrls.length > 0 && !token) {
  throw new Error("blob cleanup requires BLOB_READ_WRITE_TOKEN");
}

for (let offset = 0; offset < blobUrls.length; offset += 100) {
  await del(blobUrls.slice(offset, offset + 100), { token });
}

const updated = await sql`
  update posts
  set capture = capture - 'htmlUrl'
  where capture is not null and capture ? 'htmlUrl'
  returning id
`;
console.log(
  `Deleted ${blobUrls.length} blob${blobUrls.length === 1 ? "" : "s"} and cleaned ${updated.length} row${updated.length === 1 ? "" : "s"}.`,
);
