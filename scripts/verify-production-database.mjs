#!/usr/bin/env node

import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const protocol = new URL(databaseUrl).protocol;
if (protocol !== "postgres:" && protocol !== "postgresql:") {
  throw new Error("DATABASE_URL must use PostgreSQL.");
}

const sql = await connectMigrationDatabase(databaseUrl);
try {
  const rows = await sql`SELECT 1 AS available`;
  if (rows[0]?.available !== 1) {
    throw new Error("Production database preflight returned an unexpected result.");
  }
  console.log("Production database is available.");
} finally {
  await sql.close();
}
