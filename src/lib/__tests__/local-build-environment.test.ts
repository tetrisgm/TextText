import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { localBuildEnvironment } from "../../../scripts/with-local-database.mjs";

const roots: string[] = [];
function fixture(url: string) {
  const root = mkdtempSync(join(tmpdir(), "texttext-build-db-"));
  roots.push(root);
  writeFileSync(join(root, ".env.local"), `DATABASE_URL=${url}\n`);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true }); });

it("isolates the build from the release connection without changing the parent runtime environment", () => {
  const production = "postgres://release@example.neon.tech/texttext";
  const inherited = { DATABASE_URL: production, NEXT_DEPLOYMENT_ID: "release-identity" };
  const local = "postgres://localhost/texttext";
  expect(localBuildEnvironment(fixture(local), inherited)).toEqual({ DATABASE_URL: local, NEXT_DEPLOYMENT_ID: "release-identity" });
  expect(inherited.DATABASE_URL).toBe(production);
});

it.each(["postgres://remote.neon.tech/texttext", "not-a-url", ""])("refuses a non-local build database without disclosing it", (url) => {
  expect(() => localBuildEnvironment(fixture(url), {})).toThrow("Local builds require a local Postgres DATABASE_URL in .env.local.");
});
