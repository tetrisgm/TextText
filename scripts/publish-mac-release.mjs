// Publish a built+notarized Mac release to Vercel Blob and flip the release
// pointer, in the load-bearing order (immutable artifacts first, pointer
// last). Called by mac/scripts/release.sh after the appcast is signed.
//
//   node scripts/publish-mac-release.mjs <version> <buildNumber>
//
// Reads BLOB_READ_WRITE_TOKEN from the environment (or .env.local), derives
// the public Blob base the same way src/lib/app-release.ts does, uploads
// mac/dist/Write-<version>.zip and mac/dist/appcast.xml, then writes
// releases/mac/current.json. The appcast enclosure must already point at
// <blobBase>/downloads/Write-<version>.zip (generate_appcast is run with
// --download-url-prefix "<blobBase>/downloads/").

import pkg from "@next/env";
const { loadEnvConfig } = pkg;
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
import { put } from "@vercel/blob";
import { readFile } from "node:fs/promises";

const [version, buildRaw] = process.argv.slice(2);
const buildNumber = Number(buildRaw);
if (!version || !Number.isInteger(buildNumber) || buildNumber <= 0) {
  console.error("usage: node scripts/publish-mac-release.mjs <version> <buildNumber>");
  process.exit(64);
}

const token = process.env.BLOB_READ_WRITE_TOKEN;
const match = (token ?? "").match(/^vercel_blob_rw_([A-Za-z0-9]+)_/);
if (!match) {
  console.error("BLOB_READ_WRITE_TOKEN is missing or malformed");
  process.exit(1);
}
const blobBase = `https://${match[1].toLowerCase()}.public.blob.vercel-storage.com`;

async function upload(pathname, body, contentType) {
  const res = await put(pathname, body, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    contentType,
    token,
  });
  console.log("uploaded", pathname, "->", res.url);
  return res.url;
}

// 1. immutable zip, 2. appcast, 3. pointer LAST (never references a missing
// artifact).
const zipUrl = await upload(
  `downloads/Write-${version}.zip`,
  await readFile(`mac/dist/Write-${version}.zip`),
  "application/zip",
);
const appcastUrl = await upload(
  "downloads/appcast.xml",
  await readFile("mac/dist/appcast.xml"),
  "application/xml; charset=utf-8",
);
const pointer = {
  version,
  buildNumber,
  zipUrl,
  appcastUrl,
  publishedAt: new Date().toISOString(),
};
await upload(
  "releases/mac/current.json",
  JSON.stringify(pointer, null, 2),
  "application/json",
);
console.log("published", JSON.stringify(pointer));
console.log(`\nenclosure must be ${blobBase}/downloads/Write-${version}.zip`);
