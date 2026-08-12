import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const migration = readFileSync(
  new URL("scripts/migrate-add-slug-history.mjs", root),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
) as { scripts: { "db:push": string } };

describe("public URL migration workflow", () => {
  it("runs on local Postgres and wraps the schema change atomically", () => {
    expect(migration).toContain('import pg from "pg"');
    expect(migration).toContain('await client.query("BEGIN")');
    expect(migration).toContain('await client.query("COMMIT")');
    expect(migration).toContain('await client.query("ROLLBACK")');
  });

  it("runs before and after schema push so old and empty databases both converge", () => {
    const steps = packageJson.scripts["db:push"].split(" && ");
    const migrationIndexes = steps.flatMap((step, index) =>
      step === "node scripts/migrate-add-slug-history.mjs" ? [index] : [],
    );
    const drizzleIndex = steps.indexOf("drizzle-kit push");

    expect(migrationIndexes).toHaveLength(2);
    expect(migrationIndexes[0]).toBeLessThan(drizzleIndex);
    expect(migrationIndexes[1]).toBeGreaterThan(drizzleIndex);
    expect(migration).toContain("to_regclass('public.posts')");
  });

  it("keeps every db:push migration compatible with local Postgres", () => {
    const steps = packageJson.scripts["db:push"].split(" && ");
    const migrationPaths = steps.flatMap((step) => {
      const match = /^node (scripts\/migrate-[^ ]+\.mjs)$/.exec(step);
      return match?.[1] ? [match[1]] : [];
    });

    for (const path of migrationPaths) {
      const source = readFileSync(new URL(path, root), "utf8");
      expect(source, path).not.toContain('@neondatabase/serverless');
    }
  });

  it("guards every field that can cross the public eligibility boundary", () => {
    expect(migration).toContain("NEW.status <> 'published'");
    expect(migration).toContain("NEW.type IN ('note', 'bookmark')");
    expect(migration).toMatch(
      /UPDATE OF blog_id, folder_id, slug, visibility, status, type, deleted_at/,
    );
  });
});
