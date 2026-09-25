import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { smoke, smokeOrigin } from "./smoke.mjs";
import { localDatabase } from "./start.mjs";

test("smoke accepts only loopback HTTP port 3400 without URL credentials or suffixes", () => {
  for (const origin of ["http://127.0.0.1:3400", "http://localhost:3400", "http://[::1]:3400"]) {
    assert.equal(smokeOrigin(origin), origin);
  }
  for (const origin of ["https://texttext.app", "http://example.com:3400", "http://127.0.0.1:3000",
    "https://127.0.0.1:3400", "http://user:pass@127.0.0.1:3400", "http://127.0.0.1:3400/path",
    "http://127.0.0.1:3400?x=1", "http://127.0.0.1:3400#x"]) {
    assert.throws(() => smokeOrigin(origin), /loopback HTTP/);
  }
});

test("smoke requires explicit scratch authorization and rejects database host overrides", async () => {
  await assert.rejects(smoke(), /--scratch/);
  await assert.rejects(smoke({ scratch: true, environment: { DATABASE_URL: "postgres://example.com/scratch" } }));
  await assert.rejects(smoke({ scratch: true, environment: { DATABASE_URL: "postgres://localhost/scratch?host=example.com" } }));
});

test("a failed HTTP check removes its committed scratch account and suppresses raw errors", {
  skip: process.env.TEXTTEXT_ORACLE_SMOKE_DB_TEST !== "1",
}, async () => {
  localDatabase(process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const scratchCount = async () => Number((await client.query(
      "SELECT count(*) FROM users WHERE username LIKE 'scratch-oracle-smoke-%'",
    )).rows[0].count);
    const before = await scratchCount();
    let contactedApp = false;
    await assert.rejects(smoke({ scratch: true, fetchImpl: async () => {
      contactedApp = true;
      throw new Error("Raw transport diagnostics must not escape.");
    } }), error => error.message === "Loopback request failed: /api/app/session.");
    assert.equal(contactedApp, true, "Scratch setup must commit before simulating the HTTP failure.");
    assert.equal(await scratchCount(), before, "Failure left a scratch account in PostgreSQL.");
  } finally {
    await client.end();
  }
});
