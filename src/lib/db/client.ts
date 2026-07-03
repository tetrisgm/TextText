// The Postgres client (Neon over HTTP + Drizzle). Null when DATABASE_URL is
// unset, which is how the app stays zero-setup: store.ts falls back to the demo
// seed. Everything server side goes through store.ts, not this module directly.

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;

export const db = url ? drizzle(neon(url), { schema }) : null;
