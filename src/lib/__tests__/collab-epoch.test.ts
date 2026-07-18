import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collabPresence } from "@/lib/db/schema";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/db/client", () => ({
  get db() {
    return holder.db;
  },
}));

const { PRESENCE_STALE_MS, retireStaleCollabEpoch } = await import("@/lib/collab");

const dialect = new PgDialect();
const POST_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-07-18T12:00:00.000Z");

type Row = Record<string, unknown>;

function createFakeDb(options: {
  presence?: Row[];
  state?: Row[];
  executeRows?: Row[][];
}) {
  const calls: {
    deletes: Array<{ table: unknown; cond: unknown }>;
    executes: SQL[];
  } = { deletes: [], executes: [] };
  const executeRows = [...(options.executeRows ?? [])];
  const db = {
    select(_fields: unknown) {
      return {
        from(table: unknown) {
          return {
            where(_cond: unknown) {
              const rows = table === collabPresence
                ? (options.presence ?? [])
                : (options.state ?? []);
              return {
                limit() {
                  return Promise.resolve(rows);
                },
                then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) {
                  return Promise.resolve(rows).then(resolve, reject);
                },
              };
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        where(cond: unknown) {
          calls.deletes.push({ table, cond });
          return Promise.resolve();
        },
      };
    },
    execute(statement: SQL) {
      calls.executes.push(statement);
      return Promise.resolve({ rows: executeRows.shift() ?? [] });
    },
  };
  holder.db = db;
  return calls;
}

function query(statement: SQL) {
  return dialect.sqlToQuery(statement);
}

function normalizedSql(statement: SQL) {
  return query(statement).sql.toLowerCase().replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  holder.db = null;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("retireStaleCollabEpoch abandoned-log sweep", () => {
  it("sweeps stale presence and a materialized idle current generation", async () => {
    const calls = createFakeDb({
      state: [{ epoch: 3, materializedRevision: 7 }],
      executeRows: [[{ epoch: 4 }], []],
    });

    await expect(retireStaleCollabEpoch(POST_ID, 7)).resolves.toBe(true);

    expect(calls.deletes).toHaveLength(1);
    expect(calls.deletes[0].table).toBe(collabPresence);
    const presenceDelete = query(calls.deletes[0].cond as SQL);
    expect(presenceDelete.params).toContain(POST_ID);
    expect(presenceDelete.params).toContain(
      new Date(NOW.getTime() - PRESENCE_STALE_MS * 4).toISOString(),
    );

    expect(calls.executes).toHaveLength(2);
    const rotate = query(calls.executes[0]);
    const rotateSql = normalizedSql(calls.executes[0]);
    expect(rotateSql).toContain("update \"collab_state\"");
    expect(rotateSql).toContain("exists ( select 1 from \"posts\"");
    expect(rotateSql).toContain("exists ( select 1 from \"collab_updates\"");
    expect(rotate.params).toEqual([POST_ID, 3, 7, POST_ID, POST_ID, 3]);

    const sweepSql = normalizedSql(calls.executes[1]);
    expect(sweepSql).toContain("delete from \"collab_updates\"");
    expect(sweepSql).toContain("epoch < coalesce");
  });

  it("does not run the current-generation sweep for an unmaterialized log", async () => {
    const calls = createFakeDb({
      state: [{ epoch: 3, materializedRevision: 6 }],
      executeRows: [[], []],
    });

    await expect(retireStaleCollabEpoch(POST_ID, 7)).resolves.toBe(true);

    const retirementSql = normalizedSql(calls.executes[0]);
    expect(retirementSql).toContain("insert into \"collab_state\"");
    expect(retirementSql).not.toContain("exists ( select 1 from \"collab_updates\"");
    const sweepSql = normalizedSql(calls.executes[1]);
    expect(sweepSql).toContain("epoch < coalesce");
    expect(sweepSql).not.toContain("epoch <=");
  });

  it("does not sweep an active post", async () => {
    const calls = createFakeDb({
      presence: [{
        clientId: "live-tab",
        userName: "Ada",
        color: "#112233",
        updatedAt: NOW,
      }],
      state: [{ epoch: 3, materializedRevision: 7 }],
    });

    await expect(retireStaleCollabEpoch(POST_ID, 7)).resolves.toBe(false);
    expect(calls.deletes).toHaveLength(0);
    expect(calls.executes).toHaveLength(0);
  });

  it("keeps presence inside the 4x cleanup margin", async () => {
    const calls = createFakeDb({
      state: [{ epoch: 3, materializedRevision: 7 }],
      executeRows: [[], []],
    });
    const recentButInactive = new Date(NOW.getTime() - PRESENCE_STALE_MS * 2);

    await retireStaleCollabEpoch(POST_ID, 7);

    const cleanup = query(calls.deletes[0].cond as SQL);
    const cutoffValue = cleanup.params.find(
      (param): param is string => typeof param === "string" && param.includes("T"),
    );
    const cutoff = new Date(cutoffValue!);
    expect(recentButInactive.getTime()).toBeGreaterThan(cutoff.getTime());
    expect(cutoff).toEqual(new Date(NOW.getTime() - PRESENCE_STALE_MS * 4));
  });
});
