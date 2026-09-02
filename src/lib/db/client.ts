// The Postgres client. Null when DATABASE_URL is unset, which the store now
// treats as a configuration error rather than a mode: the demo seed that once
// answered every read without a database was removed 2026-08-14. Everything
// server side goes through store.ts, not this module directly.
//
// Two drivers by URL so local dev/test never touches the paid database:
//   - Production (Neon): the HTTP driver, unchanged.
//   - A local Postgres (dev/test/CI): the standard node-postgres pool.
// Prod always resolves to the Neon branch; the pg branch only runs for a local
// (non-neon.tech) URL.

import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NeonHttpDatabase<typeof schema>;

type AwaitableQuery = PromiseLike<unknown>;
type BatchResults<T extends readonly AwaitableQuery[]> = {
  [K in keyof T]: Awaited<T[K]>;
};

const url = process.env.DATABASE_URL;
let localPool: Pool | null = null;

// TEXTTEXT_DB_TRACE=1 stamps every query's issue time to stderr, which is how
// serial round-trip waves in a render are found. Never on in production.
const traceQueries = process.env.TEXTTEXT_DB_TRACE === "1";
const traceLogger = traceQueries
  ? {
      logQuery(query: string): void {
        process.stderr.write(
          `[db ${performance.now().toFixed(1)}] ${query.replace(/\s+/g, " ").slice(0, 120)}\n`,
        );
      },
    }
  : undefined;

function makeDb(): Database | null {
  if (!url) return null;
  if (/neon\.tech/i.test(url)) {
    return drizzleNeon(neon(url), { schema, logger: traceLogger });
  }
  // Local Postgres exposes the same Drizzle query API for everything store.ts
  // uses, so treat it as the same Db type.
  localPool = new Pool({ connectionString: url });
  return drizzlePg(localPool, {
    schema,
    logger: traceLogger,
  }) as unknown as Database;
}

export const db = makeDb();

/**
 * Execute related Drizzle queries atomically on either supported driver.
 *
 * Neon HTTP exposes atomic batches while node-postgres exposes interactive
 * transactions. The callback must build every query from the supplied
 * executor so local queries are bound to the active transaction.
 */
export async function executeAtomicBatch<
  const T extends readonly AwaitableQuery[],
>(
  build: (executor: Database) => T,
): Promise<BatchResults<T>> {
  if (!db) throw new Error("Atomic database work needs DATABASE_URL");

  if (!localPool) {
    const neonDb = db as Database & {
      batch(queries: T): Promise<BatchResults<T>>;
    };
    return neonDb.batch(build(db));
  }

  const localDb = db as Database & {
    transaction<R>(
      callback: (transaction: Database) => Promise<R>,
    ): Promise<R>;
  };
  return localDb.transaction(async (transaction) => {
    const results: unknown[] = [];
    const executor = transaction as unknown as Database;
    for (const query of build(executor)) {
      results.push(await query);
    }
    return results as BatchResults<T>;
  });
}

export async function closeDatabaseConnections(): Promise<void> {
  await localPool?.end();
  localPool = null;
}
