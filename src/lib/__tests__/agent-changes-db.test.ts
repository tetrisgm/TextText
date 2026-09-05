import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import pg from "pg";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { agentChangeContext } from "@/lib/agent-change-context.server";
import { agentChangeCte } from "@/lib/agent-change-sql.server";
import { auditCteFrom } from "@/lib/audit";
const executor = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: executor }));
vi.mock("@/lib/store", () => ({ getPostStoreContext: vi.fn() }));
import { appendCollabUpdate } from "@/lib/collab";

// Explicitly opt in against local Postgres. Every table is connection-local and
// every write rolls back. This test never modifies the development workspace.
describe.skipIf(process.env.TEXTTEXT_AGENT_HISTORY_DB_TEST !== "1")("agent history Postgres atomicity", () => {
  let client: pg.Client;
  let connected = false;
  const dialect = new PgDialect();
  const itemId = "11111111-1111-4111-8111-111111111111";
  const userId = "22222222-2222-4222-8222-222222222222";
  const actor = { userId, connectionId: "token-row", runId: "server-run", actorType: "external_agent" as const };
  const changes = [{ field: "body" as const, before: "Before", after: "After" }];
  const audit = { actorUserId: userId, actorType: "external_agent" as const, actionName: "mcp.update_item", targetType: "item" as const, targetId: itemId };
  const execute = (statement: SQL) => {
    const query = dialect.sqlToQuery(statement);
    return client.query(query.sql, query.params);
  };
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only local Postgres is allowed");
    const socket = process.env.TEXTTEXT_AGENT_HISTORY_DB_SOCKET;
    if (socket && socket !== "/private/tmp" && socket !== "/tmp") throw new Error("Use the local Postgres socket directory");
    client = new pg.Client(socket ? {
      host: socket, port: Number(url.port || 5432), database: decodeURIComponent(url.pathname.slice(1)),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    } : { connectionString: process.env.DATABASE_URL });
    await client.connect();
    connected = true;
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO pg_temp, pg_catalog");
    await client.query(`
      CREATE TEMP TABLE users (id uuid PRIMARY KEY);
      CREATE TEMP TABLE posts (id uuid PRIMARY KEY, revision bigint NOT NULL, body text);
      CREATE TEMP TABLE collab_state (post_id uuid PRIMARY KEY, epoch int NOT NULL, baseline_update text, baseline_revision bigint);
      CREATE TEMP TABLE collab_updates (post_id uuid, "update" text, epoch int, seq bigserial PRIMARY KEY);
      CREATE TEMP TABLE action_audit (actor_user_id uuid, actor_type text, action_name text, target_type text, target_id text, input_summary text, output_summary text);
    `);
    const migration = readFileSync("scripts/migrate-add-agent-changes.mjs", "utf8");
    for (let pass = 0; pass < 2; pass++) for (const match of migration.matchAll(/await sql`([\s\S]*?)`/g)) {
      await client.query(match[1].replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE IF NOT EXISTS"));
    }
    await client.query("INSERT INTO users VALUES ($1)", [userId]);
    await client.query("INSERT INTO posts VALUES ($1, 7, 'Before')", [itemId]);
    await client.query("INSERT INTO collab_state (post_id, epoch, baseline_update, baseline_revision) VALUES ($1, 0, 'baseline', 7)", [itemId]);
    executor.execute.mockImplementation(execute);
  });
  beforeEach(async () => { await client.query("SAVEPOINT scenario"); });
  afterEach(async () => { await client.query("ROLLBACK TO SAVEPOINT scenario"); });
  afterAll(async () => { if (connected) { await client.query("ROLLBACK"); await client.end(); } });
  const count = async (table: "agent_changes" | "action_audit" | "collab_updates") => (await client.query(`SELECT * FROM ${table}`)).rowCount;
  function save(expected: number, invalidActor = false) {
    return agentChangeContext.run(invalidActor ? { ...actor, userId: "33333333-3333-4333-8333-333333333333" } : actor, () => execute(sql`
      WITH changed AS (UPDATE posts SET body = 'After', revision = revision + 1
        WHERE id = ${itemId}::uuid AND revision = ${expected} RETURNING id, revision),
      audit AS (${auditCteFrom(audit, "changed", sql`changed.id::text`)}),
      history AS (${agentChangeCte({ source: "changed", postId: sql`changed.id`, revision: sql`changed.revision`, changes })})
      SELECT id FROM changed
    `));
  }
  it("commits text, identity, revision and audit together; stale CAS records nothing", async () => {
    expect((await save(7)).rowCount).toBe(1);
    expect((await save(7)).rowCount).toBe(0);
    const rows = (await client.query("SELECT * FROM agent_changes")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ connection_id: actor.connectionId, run_id: actor.runId, revision: "8", changes });
    expect(rows[0].created_at).toBeInstanceOf(Date);
    expect(await count("action_audit")).toBe(1);
  });
  it("rolls text and audit back if history cannot be stored", async () => {
    await client.query("SAVEPOINT rejected");
    await expect(save(7, true)).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT rejected");
    expect((await client.query("SELECT body FROM posts")).rows[0].body).toBe("Before");
    expect(await count("action_audit")).toBe(0);
    expect(await count("agent_changes")).toBe(0);
  });
  it("fences intervening live writes and retired epochs without phantom records; history survives compaction", async () => {
    const append = (epoch: number, expectedVersion: number) => agentChangeContext.run(actor, () =>
      appendCollabUpdate(itemId, "delta", epoch, audit, undefined, { changes, expectedVersion }));
    expect(await append(0, 0)).toHaveProperty("seq");
    expect(await append(0, 0)).toEqual({ retired: true });
    expect(await append(1, 1)).toEqual({ retired: true });
    expect(await count("agent_changes")).toBe(1);
    expect(await count("action_audit")).toBe(1);
    await client.query("DELETE FROM collab_updates");
    await client.query("UPDATE collab_state SET epoch = 1");
    expect((await client.query("SELECT * FROM agent_changes")).rows[0]).toMatchObject({ changes, collab_epoch: 0, revision: "7" });
    expect(await append(1, 1)).toHaveProperty("seq");
    expect(await count("agent_changes")).toBe(2);
  });
  it("records a revert once even after the relay is compacted", async () => {
    await save(7);
    const id = (await client.query("SELECT id FROM agent_changes")).rows[0].id;
    const revert = () => appendCollabUpdate(itemId, "inverse", 0, { ...audit, actorType: "human", actionName: "revert_agent_change" },
      undefined,
      { changes: [{ field: "body", before: "After", after: "Before" }], revert: { id, userId } });
    expect(await revert()).toHaveProperty("seq");
    await client.query("DELETE FROM collab_updates");
    await client.query("SAVEPOINT duplicate");
    await expect(revert()).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT duplicate");
    expect(await count("agent_changes")).toBe(2);
    expect(await count("action_audit")).toBe(2);
    expect(await count("collab_updates")).toBe(0);
  });
});
