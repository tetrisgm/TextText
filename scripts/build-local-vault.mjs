import { build } from "esbuild";
import { realpathSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
export function isBuildLocalVaultEntrypoint(invokedPath, moduleURL) {
  if (!invokedPath) return false;
  try {
    return realpathSync(invokedPath) === realpathSync(fileURLToPath(moduleURL));
  } catch {
    return false;
  }
}
export async function buildLocalVault({ entry = "src/local-vault/main.tsx", output = path.join(root, "mac/build/LocalVault") } = {}) {
await mkdir(output, { recursive: true });
// This policy runs in the already packaged WebView, even on home with no
// editor. Its manifest and handshake identify the exact policy source inputs.
const policySources = ["src/sync/engine/mirror-queued-upload-path.ts", "src/sync/engine/mirror-saved-rename.ts", "src/sync/engine/mirror-tombstone.ts", "src/sync/engine/mirror-shared-path.ts", "src/sync/engine/mirror-policy.ts", "src/sync/engine/mirror-schedule.ts", "src/sync/engine/mirror-queue.ts", "src/sync/engine/mirror-lifecycle.ts", "src/local-vault/mirror-policy-host.ts", "src/local-vault/mirror-policy-main.ts"];
const policyHash = createHash("sha256");
for (const source of policySources) policyHash.update(source).update("\0").update(await readFile(path.join(root, source))).update("\0");
const policyDigest = policyHash.digest("hex");
await build({ absWorkingDir: root, entryPoints: ["src/local-vault/mirror-policy-main.ts"],
  outfile: path.join(output, "mirror-policy.js"), bundle: true, platform: "browser", format: "iife", target: ["safari17"], minify: true,
  define: { TEXTTEXT_MIRROR_POLICY_DIGEST: JSON.stringify(policyDigest) } });
await writeFile(path.join(output, "mirror-policy.json"), JSON.stringify({ version: 1, digest: policyDigest }) + "\n");
await build({
  absWorkingDir: root,
  entryPoints: [entry],
  outdir: output,
  entryNames: "app",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["safari17"],
  jsx: "automatic",
  minify: true,
  logLimit: 8,
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".woff2": "file", ".woff": "file", ".ttf": "file", ".jpg": "file" },
  plugins: [{
    name: "local-vault-components",
    setup(builder) {
      // These two cloud widgets import Next server actions. The local bundle
      // supplies its own file-based look chooser and has no cloud presence.
      builder.onResolve({ filter: /(?:^|\/)ParticipantsRow$/ }, () => ({ path: path.join(root, "src/local-vault/LocalParticipants.tsx") }));
      builder.onResolve({ filter: /(?:^|\/)WorkspaceTypeLibrary$/ }, () => ({ path: path.join(root, "src/local-vault/LocalTemplateLibrary.tsx") }));
      builder.onResolve({ filter: /(?:^|\/)CommandLayer$/ }, () => ({ path: path.join(root, "src/local-vault/LocalKeyboard.ts") }));
      builder.onResolve({ filter: /^(?:@\/app\/|next\/|server-only$|node:)/ }, ({ path: imported }) => ({ errors: [{ text: `The local vault must not depend on ${imported}` }] }));
    },
  }],
});
await writeFile(path.join(output, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; media-src 'self' blob: data:; connect-src 'none'; frame-src 'none'"><title>TextText</title><link rel="stylesheet" href="app.css"></head><body style="margin:0"><div id="root"></div><script src="mirror-policy.js"></script><script src="app.js"></script></body></html>`);
await build({ absWorkingDir: root, entryPoints: ["src/local-vault/legacy-recovery-main.ts"], outfile: path.join(output, "legacy-recovery.js"), bundle: true, platform: "browser", format: "iife", target: ["safari17"], minify: true });
await copyFile(path.join(root, "src/local-vault/legacy-recovery.html"), path.join(output, "legacy-recovery.html"));
console.log(`Local vault UI bundled at ${output}`);

}
if (isBuildLocalVaultEntrypoint(process.argv[1], import.meta.url)) await buildLocalVault();
