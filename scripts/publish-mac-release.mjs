// Publish a built+notarized Mac release to Vercel Blob. Called by
// mac/scripts/release.sh after the appcast is signed. The versioned assets are
// immutable; src/generated/app-release.ts is the marker the website deploy
// flips last.
//
//   node scripts/publish-mac-release.mjs <version>
//
// Uploads (immutable first, so nothing ever references a missing artifact):
//   downloads/Write-<version>.zip  immutable, referenced by the appcast
//   downloads/appcast-<version>.xml signed immutable appcast
//   src/generated/app-release.ts    website marker for appcast/download/version
//
// The appcast enclosure must already be the immutable Blob URL
// <blobBase>/downloads/Write-<version>.zip (release.sh runs generate_appcast
// with --download-url-prefix "<blobBase>/downloads/").

import pkg from "@next/env";
const { loadEnvConfig } = pkg;
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
import { put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";

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
const storeId = token.match(/^vercel_blob_rw_([A-Za-z0-9]+)_/)?.[1]?.toLowerCase();
const blobBase = `https://${storeId}.public.blob.vercel-storage.com`;

async function upload(pathname, body, contentType, allowOverwrite) {
  const res = await put(pathname, body, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite,
    cacheControlMaxAge: allowOverwrite ? 60 : 31_536_000,
    contentType,
    token,
  });
  console.log("uploaded", pathname, "->", res.url);
}

const zip = await readFile(`mac/dist/Write-${version}.zip`);
const appcast = await readFile("mac/dist/appcast.xml", "utf8");
const buildNumber = Number(appcast.match(/<sparkle:version>(\d+)<\/sparkle:version>/)?.[1]);
if (!Number.isInteger(buildNumber) || buildNumber <= 0) {
  console.error("mac/dist/appcast.xml has no usable sparkle:version");
  process.exit(1);
}
const shortVersion = appcast.match(
  /<sparkle:shortVersionString>([^<]+)<\/sparkle:shortVersionString>/,
)?.[1];
if (shortVersion !== version) {
  console.error(`mac/dist/appcast.xml advertises ${shortVersion}, expected ${version}`);
  process.exit(1);
}
const hardwareRequirements = appcast.match(
  /<sparkle:hardwareRequirements>([^<]+)<\/sparkle:hardwareRequirements>/,
)?.[1]?.trim();
if (hardwareRequirements !== "arm64") {
  console.error(
    `mac/dist/appcast.xml requires ${hardwareRequirements ?? "no architecture"}, expected arm64`,
  );
  process.exit(1);
}

const zipUrl = `${blobBase}/downloads/Write-${version}.zip`;
const appcastUrl = `${blobBase}/downloads/appcast-${version}.xml`;

// Immutable per-version zip first; the immutable appcast references it. The
// stable aliases are maintained as best-effort human conveniences, but the app
// and website never depend on overwriting them.
await upload(`downloads/Write-${version}.zip`, zip, "application/zip", false);
await upload(
  `downloads/appcast-${version}.xml`,
  appcast,
  "application/xml; charset=utf-8",
  false,
);
await upload(
  "downloads/Write.zip",
  zip,
  "application/zip",
  true,
);
await upload(
  "downloads/appcast.xml",
  appcast,
  "application/xml; charset=utf-8",
  true,
);

await mkdir("src/generated", { recursive: true });
await writeFile(
  "src/generated/app-release.ts",
  [
    "export const generatedAppRelease = {",
    `  version: ${JSON.stringify(version)},`,
    `  buildNumber: ${buildNumber},`,
    `  appcastUrl:`,
    `    ${JSON.stringify(appcastUrl)},`,
    `  zipUrl:`,
    `    ${JSON.stringify(zipUrl)},`,
    "} as const;",
    "",
  ].join("\n"),
);
console.log("updated src/generated/app-release.ts");
console.log(`published v${version}`);
