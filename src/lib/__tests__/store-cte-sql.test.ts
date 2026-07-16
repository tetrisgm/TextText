import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/neon-http";
import { PgDialect } from "drizzle-orm/pg-core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { posts } from "@/lib/db/schema";
import { auditCteFrom } from "@/lib/audit";

// The atomic-audit mutations (deletePostAtomic, movePostFile) hand-compose a
// `WITH changed AS <write>, audit AS (<insert>) SELECT id FROM changed` CTE so
// the mutation and its audit row commit together. That raw composition is not
// executed by any unit test (the live smoke covers execution), so these lock
// the one property that would only fail at runtime: the SQL renders to valid
// single-paren Postgres. drizzle only builds SQL here; no connection is used.
const dialect = new PgDialect();
// A function client is used verbatim (no neon() connection attempt); it is
// never called because we render SQL rather than execute it.
const qb = drizzle((() => {}) as never); // query builder only, never executed

const audit = auditCteFrom(
  {
    actorUserId: "11111111-1111-4111-8111-111111111111",
    actorType: "external_agent",
    actionName: "sync.delete_file",
    targetType: "item",
    inputSummary: "Title",
  },
  "changed",
  sql`changed.id::text`,
);

describe("movePostFile atomic-audit CTE", () => {
  it("embeds the drizzle UPDATE as a single-paren CTE body (no paren trap)", () => {
    // Exactly the shape store.ts builds: an embedded drizzle UPDATE ... RETURNING
    // as the `changed` CTE body, with `AS ${q}` (NOT `AS (${q})`).
    const updateQuery = qb
      .update(posts)
      .set({ slug: "new-slug", folderId: "f1" })
      .where(and(eq(posts.id, "p1"), eq(posts.blogId, "b1"), isNull(posts.deletedAt)))
      .returning({ id: posts.id });
    const stmt = sql`
      WITH changed AS ${updateQuery}, audit AS (${audit})
      SELECT id FROM changed
    `;
    const compiled = dialect.sqlToQuery(stmt);
    const lower = compiled.sql.toLowerCase().replace(/\s+/g, " ");

    expect(lower).toContain("with changed as (update");
    // The paren trap this guards against: a double-open before `update`.
    expect(lower).not.toContain("as ((update");
    expect(lower).toContain('insert into "action_audit"');
    expect(lower).toContain("select id from changed");
  });
});

describe("deletePostAtomic atomic-audit CTE", () => {
  it("renders the raw soft-delete UPDATE as a valid single-paren CTE body", () => {
    // The hand-written raw form store.ts uses for the guarded soft-delete.
    const stmt = sql`
      WITH changed AS (
        UPDATE ${posts} SET deleted_at = now(), updated_at = now()
        WHERE id = ${"p1"} AND blog_id = ${"b1"}
          AND deleted_at IS NULL AND revision = ${7}
        RETURNING id
      ), audit AS (${audit})
      SELECT id FROM changed
    `;
    const compiled = dialect.sqlToQuery(stmt);
    const lower = compiled.sql.toLowerCase().replace(/\s+/g, " ");

    expect(lower).toContain("with changed as ( update");
    expect(lower).toContain("returning id");
    expect(lower).toContain('insert into "action_audit"');
    expect(lower).toContain("select id from changed");
    // The guarded revision + ids are bound as params, not inlined.
    expect(compiled.params).toContain("p1");
    expect(compiled.params).toContain(7);
  });
});
