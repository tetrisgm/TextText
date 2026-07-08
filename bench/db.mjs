import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.replace(/^"|"$/g, "");
const sql = neon(get("DATABASE_URL") || get("POSTGRES_URL"));
const rows = await sql.query(process.argv[2], JSON.parse(process.argv[3] || "[]"));
console.log(JSON.stringify(rows));
