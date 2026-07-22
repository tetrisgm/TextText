// The Postgres client. Null when DATABASE_URL is unset, which is how the app
// stays zero-setup: store.ts falls back to the demo seed. Everything server
// side goes through store.ts, not this module directly.
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

type Db = NeonHttpDatabase<typeof schema>;

const url = process.env.DATABASE_URL;

function makeDb(): Db | null {
  if (!url) return null;
  if (/neon\.tech/i.test(url)) {
    return drizzleNeon(neon(url), { schema });
  }
  // Local Postgres exposes the same Drizzle query API for everything store.ts
  // uses, so treat it as the same Db type.
  return drizzlePg(new Pool({ connectionString: url }), {
    schema,
  }) as unknown as Db;
}

export const db = makeDb();
