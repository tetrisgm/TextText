// Human-invoked only, after signing/notarization. Immutable Oracle artifacts first;
// the generated manifest is written last, after their public URLs are verified.
import pkg from "@next/env";
import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { releaseStorageConfig, inspectReleaseFile, uploadReleaseFile, inspectAppcast, verifyPublicArtifact } from "./release-storage.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
pkg.loadEnvConfig(root, true, { info() {}, error() {} });

async function main() {
  const config = releaseStorageConfig();
  if (process.argv[2] === "--print-base") { console.log(config.base); return; }
  const version = process.argv[2];
  if (!version || !/^[0-9]+(\.[0-9]+)+$/.test(version)) throw new Error("usage: node scripts/publish-mac-release.mjs <version>");
  const zipFile = path.join(root, `mac/dist/TextText-${version}.zip`), appcastFile = path.join(root, "mac/dist/appcast.xml");
  if ((await stat(appcastFile)).size > 1024 * 1024) throw new Error("Appcast exceeds its size limit.");
  const zip = await inspectReleaseFile(zipFile), appcast = await inspectReleaseFile(appcastFile);
  const zipKey = `downloads/TextText-${version}.zip`, appcastKey = `downloads/appcast-${version}.xml`;
  const zipUrl = `${config.base}/${zipKey}`, appcastUrl = `${config.base}/${appcastKey}`;
  const buildNumber = inspectAppcast(await readFile(appcastFile, "utf8"), version, zipUrl, zip.length);
  await uploadReleaseFile(config, zipKey, zipFile, "application/zip", zip);
  await verifyPublicArtifact(zipUrl, zip);
  await uploadReleaseFile(config, appcastKey, appcastFile, "application/xml; charset=utf-8", appcast);
  await verifyPublicArtifact(appcastUrl, appcast);
  const destination = path.join(root, "src/generated/app-release.ts"), temporary = `${destination}.${process.pid}.tmp`;
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(temporary, `export const generatedAppRelease = ${JSON.stringify({ version, buildNumber, appcastUrl, zipUrl }, null, 2)} as const;\n`);
  await rename(temporary, destination);
  console.log(`Published immutable v${version} artifacts; generated release marker is ready for the web deployment.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Release publication failed."); process.exitCode = 1; });
