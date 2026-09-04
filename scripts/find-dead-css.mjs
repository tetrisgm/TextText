/**
 * Find (and with --write, drop) every rule whose selectors are all built
 * from classes no source file mentions.
 *
 *   node scripts/find-dead-css.mjs            # dry run, lists what would go
 *   node scripts/find-dead-css.mjs --write    # apply
 *
 * Verify a --write with the surface walk in the same directory as this
 * script's sibling probes: capture every surface before and after and diff.
 * The walk's own noise floor is one bookmark thumbnail that sometimes loads
 * and sometimes does not, about 0.03% of a frame; anything larger is real. Parsed with postcss rather than by hand: a stylesheet is not a
 * brace-counting exercise, and a hand-rolled pass produced invalid CSS.
 *
 * A rule survives if ANY of its selectors could still match, so an element
 * selector, an attribute selector, or one live class keeps it. At-rules that
 * end up empty go with it.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";

const cssDir = "src/styles";
const files = readdirSync(cssDir).filter((f) => f.endsWith(".css"));

const sources = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(p);
    } else if (/\.(tsx?|mjs|js|json|md|swift|html)$/.test(entry)) sources.push(p);
  }
};
walk("src");
walk("mac");
const haystack = sources.map((p) => readFileSync(p, "utf8")).join("\n");

const liveCache = new Map();
const liveClass = (name) => {
  const hit = liveCache.get(name);
  if (hit !== undefined) return hit;
  let live = haystack.includes(name);
  if (!live) {
    const parts = name.split("-");
    for (let i = parts.length - 1; i > 1; i -= 1) {
      if (haystack.includes(parts.slice(0, i).join("-") + "-")) { live = true; break; }
    }
  }
  liveCache.set(name, live);
  return live;
};

const selectorSurvives = (selector) => {
  const classes = [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  if (classes.length === 0) return true;
  return classes.some(liveClass);
};

let rulesDropped = 0;
let selectorsDropped = 0;
const dropped = [];

const prune = (root) => {
  root.walkRules((rule) => {
    // Inside @keyframes the "selector" is 0%/from/to.
    if (rule.parent?.type === "atrule" && /keyframes/i.test(rule.parent.name)) return;
    const selectors = rule.selectors ?? [];
    const kept = selectors.filter(selectorSurvives);
    if (kept.length === 0) {
      rulesDropped += 1;
      dropped.push(rule.selector.replace(/\s+/g, " ").slice(0, 90));
      rule.remove();
    } else if (kept.length !== selectors.length) {
      selectorsDropped += selectors.length - kept.length;
      rule.selectors = kept;
    }
  });
  // Empty at-rules left behind.
  let again = true;
  while (again) {
    again = false;
    root.walkAtRules((at) => {
      if (!/^(media|supports|container|layer|scope)$/i.test(at.name)) return;
      if (at.nodes && at.nodes.every((n) => n.type === "comment")) {
        at.remove();
        again = true;
      }
    });
  }
};

let before = 0;
let after = 0;
for (const f of files) {
  const p = join(cssDir, f);
  const text = readFileSync(p, "utf8");
  before += text.length;
  const root = postcss.parse(text, { from: p });
  prune(root);
  const out = root.toString();
  after += out.length;
  if (process.argv[2] === "--write" && out !== text) writeFileSync(p, out);
}
console.log(
  `${rulesDropped} rules dropped, ${selectorsDropped} selectors trimmed; ${(before / 1024).toFixed(1)}KB -> ${(after / 1024).toFixed(1)}KB (-${((before - after) / 1024).toFixed(1)}KB)`,
);
if (process.argv[2] !== "--write") {
  console.log("\ndry run. sample of what would go:\n");
  for (const d of dropped.slice(0, 25)) console.log("  " + d);
}
