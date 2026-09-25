// The Postgres client. Null when DATABASE_URL is unset, which the store now
// treats as a configuration error rather than a mode: the demo seed that once
// answered every read without a database was removed 2026-08-14. Everything
// server side goes through store.ts, not this module directly.
//
// Production and local development use the same PostgreSQL driver. DATABASE_URL
// chooses the database; local development and tests must use local Postgres.

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

type AwaitableQuery = PromiseLike<unknown>;
type BatchResults<T extends readonly AwaitableQuery[]> = {
  [K in keyof T]: Awaited<T[K]>;
};

const url = process.env.DATABASE_URL;
let pool: Pool | null = null;

// TEXTTEXT_DB_TRACE=1 stamps every query's issue time to stderr, which is how
// serial round-trip waves in a render are found. Never on in production.
const traceQueries = process.env.TEXTTEXT_DB_TRACE === "1";

// Keep a query counter so page and sync tests can hold work to a budget. It
// stays enabled in production without recording SQL or parameters.
let issued = 0;

/** Queries issued since the process started. Compare two readings. */
export function queriesIssued(): number {
  return issued;
}

const countingLogger = {
  logQuery(query: string): void {
    issued += 1;
    if (traceQueries) {
      process.stderr.write(
        `[db ${performance.now().toFixed(1)}] ${query.replace(/\s+/g, " ").slice(0, 120)}\n`,
      );
    }
  },
};

function makeDb(): Database | null {
  if (!url) return null;
  pool = new Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 10_000,
  });
  // A dropped idle connection must not crash the long-lived app process.
  pool.on("error", (error) => {
    console.error("Idle database connection failed", error.name);
  });
  return drizzle(pool, { schema, logger: countingLogger });
}

export const db = makeDb();

/**
 * Execute related Drizzle queries in one PostgreSQL transaction. Build every
 * query from the supplied executor so a failure rolls back the entire batch,
 * including its audit row.
 */
export async function executeAtomicBatch<
  const T extends readonly AwaitableQuery[],
>(
  build: (executor: Database) => T,
): Promise<BatchResults<T>> {
  if (!db) throw new Error("Atomic database work needs DATABASE_URL");

  return db.transaction(async (transaction) => {
    const results: unknown[] = [];
    for (const query of build(transaction)) {
      results.push(await query);
    }
    return results as BatchResults<T>;
  });
}

export async function closeDatabaseConnections(): Promise<void> {
  await pool?.end();
  pool = null;
}
