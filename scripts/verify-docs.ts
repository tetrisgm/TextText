// Keep the documentation from rotting into a trap.
//
// Three times now, stale files have cost real work: a health-check list written
// out in three languages, tool references naming tools that no longer existed,
// and a changelog instruction pointing at a note that was never there. Sweeping
// by hand finds those once. This finds them every release.
//
// Checks, all mechanical, no judgement:
//
//   1. Every repo path named in a doc or script actually exists.
//   2. Every relative Markdown link resolves.
//   3. Every script under scripts/, mac/scripts/, release/ is reachable from
//      package.json, another script, a doc, or a launchd plist.
//   4. No doc OUTSIDE docs/archive/ declares itself shipped or superseded.
//      A finished plan belongs in the archive, with a banner saying so.
//   5. Every doc INSIDE docs/archive/ opens with such a banner.
//
//   npx tsx scripts/verify-docs.ts

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { repositoryRoot } from "./work-unit";

const tracked = execFileSync("git", ["ls-files"], {
  cwd: repositoryRoot,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const read = (path: string) => {
  try {
    return readFileSync(join(repositoryRoot, path), "utf8");
  } catch {
    return "";
  }
};
const exists = (path: string) => existsSync(join(repositoryRoot, path));

const problems: string[] = [];
const note = (message: string) => problems.push(message);

const docs = tracked.filter((f) => f.endsWith(".md"));
const textFiles = tracked.filter((f) =>
  /\.(md|sh|ts|tsx|mjs|js|swift|py|json|ya?ml|plist)$/.test(f),
);

// 1. Repo paths named anywhere must exist. Only match paths under real source
// roots, so prose like "notes/2026" never trips this. The lookbehind keeps the
// match anchored at the start of a path, so `$MAC/scripts/build-app.sh` and
// `.agents/plugins/marketplace.json` are not misread as repo-root paths.
//
// docs/archive/ is exempt: a historical record describes files as they were,
// and most of them are deleted now. That is what makes it history.
const PATH_RE =
  /(?<![\w./-])((?:src|mac|scripts|release|plugins|docs)\/[A-Za-z0-9._/[\]-]*\.[A-Za-z0-9]{1,5})\b/g;
for (const file of textFiles) {
  if (file.startsWith("docs/archive/")) continue;
  for (const [, path] of read(file).matchAll(PATH_RE)) {
    const candidate = path.replace(/\.$/, "");
    if (!exists(candidate)) {
      note(`${file}: names a path that does not exist: ${candidate}`);
    }
  }
}

// 2. Relative Markdown links.
for (const file of docs) {
  const base = dirname(join(repositoryRoot, file));
  for (const [, target] of read(file).matchAll(/\]\(([^)#:]+\.md)\)/g)) {
    if (!existsSync(resolve(base, target)) && !exists(target)) {
      note(`${file}: broken Markdown link: ${target}`);
    }
  }
}

// 3. Unreachable scripts. A script nothing invokes is either dead weight or,
// worse, a step someone believes runs. Reference it from a doc if it is a
// deliberate manual tool.
const scripts = tracked.filter(
  (f) =>
    /^(scripts|mac\/scripts|release)\//.test(f) &&
    /\.(sh|ts|mjs|js|py)$/.test(f),
);
const corpus = new Map(textFiles.map((f) => [f, read(f)]));
const plists = tracked.filter((f) => f.endsWith(".plist")).map(read).join("\n");
for (const script of scripts) {
  const base = script.split("/").pop()!;
  const stem = base.replace(/\.[^.]+$/, "");
  const referenced = [...corpus].some(
    ([file, body]) =>
      file !== script && (body.includes(base) || body.includes(`/${stem}"`)),
  );
  if (!referenced && !plists.includes(base)) {
    note(
      `${script}: nothing invokes this. Wire it up, reference it from a doc, or delete it.`,
    );
  }
}

// 4 and 5. A finished plan in docs/ reads as current work. Move it.
const DONE = /\b(SHIPPED|DELIVERED|SUPERSEDED|RESOLVED AND SHIPPED)\b/;
for (const file of docs) {
  const archived = file.startsWith("docs/archive/");
  const head = read(file).split("\n").slice(0, 12).join("\n");
  const status = head.match(/^\s*>?\s*\*{0,2}(?:STATUS|Status)[^\n]*/m)?.[0] ?? "";
  if (!archived && DONE.test(status)) {
    note(
      `${file}: status says "${status.trim().slice(0, 60)}". Move it to docs/archive/ with a banner.`,
    );
  }
  if (archived && !/ARCHIVED/.test(head)) {
    note(`${file}: in docs/archive/ but has no ARCHIVED banner naming what replaced it.`);
  }
}

if (problems.length > 0) {
  console.error(`Documentation is stale (${problems.length}):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  JSON.stringify({
    status: "pass",
    docs: docs.length,
    scripts: scripts.length,
    archived: docs.filter((d) => d.startsWith("docs/archive/")).length,
  }),
);
