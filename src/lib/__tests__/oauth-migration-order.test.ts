import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("OAuth retirement migration", () => {
  it("drops every dependent token table before its parent without CASCADE", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts", "migrate-drop-oauth.mjs"),
      "utf8",
    );
    const statements = [
      "DROP TABLE IF EXISTS oauth_access_tokens",
      "DROP TABLE IF EXISTS oauth_refresh_tokens",
      "DROP TABLE IF EXISTS oauth_authorization_codes",
      "DROP TABLE IF EXISTS oauth_refresh_token_families",
      "DROP TABLE IF EXISTS oauth_clients",
    ];
    const positions = statements.map((statement) => source.indexOf(statement));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(source).not.toMatch(/DROP TABLE[^;]+CASCADE/);
    expect(source).toContain("connectMigrationDatabase(databaseUrl)");
  });
});
