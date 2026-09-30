// One-time migration, also safe to rerun when a preset gains a public cover.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { embedBuiltinPresetAssets, builtinBrowserDocument } from "./builtin-preset-assets";
import { parseTextpack } from "../src/lib/github/textpack";

const root = process.cwd();
const directory = join(root, "presets", "builtin");
// Validate every output before changing any pack.
const packs = readdirSync(directory).filter((name) => name.endsWith(".textpack")).sort().map((name) => {
  const path = join(directory, name);
  const before = readFileSync(path);
  const after = embedBuiltinPresetAssets(before, root);
  builtinBrowserDocument(after, parseTextpack(after).document, root);
  return { path, name, before, after };
});
for (const pack of packs) {
  if (pack.before.equals(pack.after)) continue;
  if (process.argv.includes("--check")) throw new Error(`${pack.name}: embed its original cover assets first`);
  writeFileSync(pack.path, pack.after);
}
console.log(`Checked ${packs.length} portable built-in TextPacks.`);
