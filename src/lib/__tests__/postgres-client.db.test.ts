import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { connectMigrationDatabase } from "../../../scripts/lib/postgres-migration.mjs";

const enabled = process.env.TEXTTEXT_READING_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("PostgreSQL adapter", () => {
  let client: typeof import("@/lib/db/client");
  let schema: typeof import("@/lib/db/schema");
  const targetId = `postgres-adapter-${randomUUID()}`;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error("Only local Postgres is allowed");
    }
    client = await import("@/lib/db/client");
    schema = await import("@/lib/db/schema");
  });

  afterAll(async () => {
    if (!client?.db) return;
    await client.db.delete(schema.actionAudit).where(eq(schema.actionAudit.targetId, targetId));
    await client.closeDatabaseConnections();
  });

  it("runs a batch on one transaction and returns ordered query results", async () => {
    const [inserted, selected] = await client.executeAtomicBatch((transaction) => [
      transaction.insert(schema.actionAudit).values({
        actorType: "system", actionName: "postgres.adapter.commit", targetType: "item", targetId,
      }).returning({ id: schema.actionAudit.id }),
      transaction.select({ id: schema.actionAudit.id }).from(schema.actionAudit)
        .where(eq(schema.actionAudit.targetId, targetId)),
    ] as const);

    expect(inserted).toHaveLength(1);
    expect(selected).toEqual(inserted);
    expect(await client.db!.select({ id: schema.actionAudit.id }).from(schema.actionAudit)
      .where(eq(schema.actionAudit.targetId, targetId))).toEqual(inserted);
  });

  it("rolls back an earlier write when a later statement fails", async () => {
    const actionName = `postgres.adapter.rollback.${targetId}`;
    await expect(client.executeAtomicBatch((transaction) => [
      transaction.insert(schema.actionAudit).values({
        actorType: "system", actionName, targetType: "item", targetId,
      }),
      transaction.execute(sql`select 1 / 0`),
    ] as const)).rejects.toThrow();

    expect(await client.db!.select().from(schema.actionAudit)
      .where(eq(schema.actionAudit.actionName, actionName))).toEqual([]);
  });

  it("supports parameterized migration queries without an HTTP database driver", async () => {
    const migration = await connectMigrationDatabase(process.env.DATABASE_URL!);
    try {
      const value = "apostrophe ' and $1 remain data";
      expect(await migration`select ${value}::text as value`).toEqual([{ value }]);
      expect(await migration.query("select $1::text as value", [value])).toEqual([{ value }]);
    } finally {
      await migration.close();
    }
  });
});
