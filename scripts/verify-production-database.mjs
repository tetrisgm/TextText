#!/usr/bin/env node

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const host = new URL(databaseUrl.replace(/^postgres(ql)?:/, "https:")).hostname;
if (!host.endsWith(".neon.tech")) {
  throw new Error("DATABASE_URL must point to the production Neon database.");
}

const sql = neon(databaseUrl);
const rows = await sql`SELECT 1 AS available`;
if (rows[0]?.available !== 1) {
  throw new Error("Production database preflight returned an unexpected result.");
}

console.log("Production database is available.");
