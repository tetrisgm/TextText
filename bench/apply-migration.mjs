import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.replace(/^"|"$/g, "");
const sql = neon(get("DATABASE_URL") || get("POSTGRES_URL"));
const file = process.argv[2];
const raw = fs.readFileSync(file, "utf8");
// split on semicolons at statement end (no semicolons appear inside these statements)
const stmts = raw.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("--"));
for (const s of stmts) {
  const label = s.slice(0, 60).replace(/\s+/g, " ");
  try { await sql.query(s); console.log("OK  ", label); }
  catch (e) { console.log("FAIL", label, "->", String(e.message).slice(0, 90)); }
}
