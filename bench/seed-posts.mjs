import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.replace(/^"|"$/g, "");
const sql = neon(get("DATABASE_URL") || get("POSTGRES_URL"));

const BLOG = "eb0328fd-0c01-48c9-8ebd-979037c94bba";
const BLOG_FOLDER = "73a450a4-4653-422a-aca4-37dcc1eab1a3";
const N = Number(process.env.SEED_N || 18);

const para = "Performance is a feeling before it is a number. The interface should react the instant you act, and the network should be a background detail. This post explores how local-first tools keep every interaction under the threshold of perception, and why a round-trip on the critical path is the thing you can always feel.";
function body(i) {
  return [
    `## Section one for post ${i}`, para,
    `### A subheading`, para,
    `- a list item`, `- another item`, `- a third item`,
    `## Section two`, para, para,
    `> A short pull quote about latency budgets.`, para,
  ].join("\n\n");
}

// clear any prior bench articles so re-runs are idempotent
await sql.query(`delete from posts where blog_id=$1 and folder_id=$2 and type='article' and title like 'Bench Article %'`, [BLOG, BLOG_FOLDER]);

let n = 0;
for (let i = 1; i <= N; i++) {
  const title = `Bench Article ${String(i).padStart(2, "0")}`;
  const slug = `bench-article-${String(i).padStart(2, "0")}`;
  await sql.query(
    `insert into posts (blog_id, folder_id, slug, title, body, excerpt, status, type, published_at, pinned)
     values ($1,$2,$3,$4,$5,$6,'published','article', now() - ($7 || ' minutes')::interval, $8)`,
    [BLOG, BLOG_FOLDER, slug, title, body(i), "A representative article body for benchmarking navigation and render cost.", String(i), i <= 2]
  );
  n++;
}
const [{ count }] = await sql.query(`select count(*)::int as count from posts where blog_id=$1 and folder_id=$2 and type='article' and deleted_at is null`, [BLOG, BLOG_FOLDER]);
console.log(`seeded ${n} articles; blog now has ${count} articles in Blog folder`);
