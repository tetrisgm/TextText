// Publish a built+notarized Mac release to Vercel Blob at fixed paths. Called
// by mac/scripts/release.sh after the appcast is signed. There is no release
// pointer: the fixed appcast.xml is the source of truth (see app-release.ts).
//
//   node scripts/publish-mac-release.mjs <version>
//
// Uploads (immutable first, so nothing ever references a missing artifact):
//   downloads/Write-<version>.zip  immutable, referenced by the appcast
//   downloads/Write.zip            stable "latest" alias for /download/Write.zip
//   downloads/appcast.xml          the signed appcast (SUFeedURL resolves here)
//
// The appcast enclosure must already be the immutable Blob URL
// <blobBase>/downloads/Write-<version>.zip (release.sh runs generate_appcast
// with --download-url-prefix "<blobBase>/downloads/").

import pkg from "@next/env";
const { loadEnvConfig } = pkg;
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
import { put } from "@vercel/blob";
import { readFile } from "node:fs/promises";

const version = process.argv[2];
if (!version || !/^[0-9]+(\.[0-9]+)+$/.test(version)) {
  console.error("usage: node scripts/publish-mac-release.mjs <version>");
  process.exit(64);
}

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!/^vercel_blob_rw_[A-Za-z0-9]+_/.test(token ?? "")) {
  console.error("BLOB_READ_WRITE_TOKEN is missing or malformed");
  process.exit(1);
}

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
}

const zip = await readFile(`mac/dist/Write-${version}.zip`);
// Immutable per-version zip first (the appcast points here), then the stable
// alias, then the appcast last.
await upload(`downloads/Write-${version}.zip`, zip, "application/zip");
await upload("downloads/Write.zip", zip, "application/zip");
await upload(
  "downloads/appcast.xml",
  await readFile("mac/dist/appcast.xml"),
  "application/xml; charset=utf-8",
);
console.log(`published v${version}`);
