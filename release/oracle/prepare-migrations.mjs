#!/usr/bin/env node
// Generate a portable database release on the Mac. Never connects to a database.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hash = (data) => createHash("sha256").update(data).digest("hex");

export function migrationSources(projectRoot) {
  const source = readFileSync(join(projectRoot, "scripts/run-release-migrations.sh"), "utf8");
  const order = source.match(/^migrations=\(\n([\s\S]*?)^\)/m)?.[1];
  if (!order) throw new Error("Cannot read the release migration order.");
  const migrations = order.trim().split(/\s+/);
  const available = readdirSync(join(projectRoot, "scripts")).filter((name) => /^migrate-.*\.mjs$/.test(name));
  if (new Set(migrations).size !== migrations.length || available.length !== migrations.length ||
      available.some((name) => !migrations.includes(`scripts/${name}`))) {
    throw new Error("The release migration order does not cover every migration exactly once.");
  }
  const compiled = [...source.matchAll(/^npx tsx (scripts\/[\w-]+\.ts)$/gm)].map((match) => match[1]);
  if (compiled.length !== 3) throw new Error("Review the changed TypeScript release migration chain.");
  return { migrations, compiled };
}

export async function prepareMigrations({ projectRoot = root, output }) {
  if (process.platform !== "darwin") throw new Error("Prepare database releases on the Mac.");
  const target = resolve(output);
  if (existsSync(target)) throw new Error("Refusing to overwrite an existing database release.");
  const { migrations, compiled } = migrationSources(projectRoot);
  const scratchParent = join(projectRoot, ".texttext");
  mkdirSync(scratchParent, { recursive: true });
  const scratch = mkdtempSync(join(scratchParent, "oracle-schema-"));
  mkdirSync(join(target, "scripts/lib"), { recursive: true });
  try {
    const schemaModule = join(scratch, "schema.mjs");
    await build({
      absWorkingDir: projectRoot,
      entryPoints: ["src/lib/db/schema.ts"],
      outfile: schemaModule,
      bundle: true, packages: "external", platform: "node", target: "node22", format: "esm",
    });
    const schema = await import(pathToFileURL(schemaModule).href);
    const empty = generateDrizzleJson({});
    const current = generateDrizzleJson(schema, empty.id);
    const statements = await generateMigration(empty, current);
    if (statements.length === 0) throw new Error("Generated database schema is empty.");
    writeFileSync(join(target, "schema.sql"), statements.join("\n\n") + "\n", { flag: "wx" });

    const files = ["schema.sql", "scripts/lib/postgres-migration.mjs"];
    cpSync(join(projectRoot, "scripts/lib/postgres-migration.mjs"), join(target, "scripts/lib/postgres-migration.mjs"));
    for (const path of migrations) {
      cpSync(join(projectRoot, path), join(target, path));
      files.push(path);
    }
    const bundled = [];
    for (const path of compiled) {
      const destination = path.replace(/\.ts$/, ".cjs");
      await build({
        absWorkingDir: projectRoot, entryPoints: [path], outfile: join(target, destination),
        bundle: true, packages: "external", platform: "node", target: "node22", format: "cjs",
        tsconfig: join(projectRoot, "tsconfig.json"),
      });
      bundled.push(destination);
      files.push(destination);
    }
    const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" });
    if (commit.status !== 0) throw new Error("Cannot identify the database release source.");
    const manifest = {
      format: 1,
      commit: commit.stdout.trim(),
      nodeMajor: 22,
      preparedAt: new Date().toISOString(),
      migrations: [...migrations, ...bundled],
      files: Object.fromEntries(files.map((path) => [path, hash(readFileSync(join(target, path)))])),
    };
    writeFileSync(join(target, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    return target;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--out") throw new Error("Usage: prepare-migrations.mjs --out <new directory>");
    console.log(await prepareMigrations({ output: process.argv[3] }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Database release preparation failed.");
    process.exitCode = 1;
  }
}
