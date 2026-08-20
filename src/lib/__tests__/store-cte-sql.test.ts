import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/neon-http";
import { PgDialect } from "drizzle-orm/pg-core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { idempotencyKeys, itemComments, posts } from "@/lib/db/schema";
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
      .where(
        and(
          eq(posts.id, "p1"),
          eq(posts.blogId, "b1"),
          isNull(posts.deletedAt),
        ),
      )
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

describe("document save atomic-audit CTEs", () => {
  it("renders a final-content INSERT and its audit as one statement", () => {
    const insertQuery = qb
      .insert(posts)
      .values({
        id: "p1",
        blogId: "b1",
        folderId: "f1",
        document: {
          schemaVersion: 1,
          content: {
            title: "Finished draft",
            body: "Complete body",
            fields: {},
            tags: [],
            assets: [],
          },
          presentation: {
            template: { id: "article", version: 1 },
            theme: {},
          },
        },
        type: "article",
        slug: "finished-draft",
        title: "Finished draft",
        body: "Complete body",
        status: "draft",
      })
      .returning({ id: posts.id });
    const stmt = sql`
      WITH changed AS ${insertQuery}, audit AS (${audit})
      SELECT id FROM changed
    `;
    const compiled = dialect.sqlToQuery(stmt);
    const lower = compiled.sql.toLowerCase().replace(/\s+/g, " ");

    expect(lower).toContain("with changed as (insert");
    expect(lower).not.toContain("as ((insert");
    expect(lower).toContain('insert into "action_audit"');
    expect(compiled.params).toContain("Complete body");
  });

  it("resolves a create idempotency claim before the final insert can land", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const claimedBlogId = sql<string>`(SELECT blog_id FROM claimed LIMIT 1)`;
    const insertQuery = qb
      .insert(posts)
      .values({
        id,
        blogId: claimedBlogId,
        folderId: "f1",
        document: {
          schemaVersion: 1,
          content: {
            title: "Once",
            body: "Created once",
            fields: {},
            tags: [],
            assets: [],
          },
          presentation: {
            template: { id: "article", version: 1 },
            theme: {},
          },
        },
        type: "article",
        slug: "once",
        title: "Once",
        body: "Created once",
        status: "draft",
      })
      .returning({ id: posts.id });
    const stmt = sql`
      WITH claimed AS (
        UPDATE ${idempotencyKeys}
        SET result_kind = 'post', result_id = ${id}
        WHERE blog_id = ${"b1"} AND key = ${"agent:create:k1"}
          AND result_id IS NULL
        RETURNING blog_id
      ), changed AS ${insertQuery}, audit AS (${audit})
      SELECT id FROM changed
    `;
    const compiled = dialect.sqlToQuery(stmt);
    const lower = compiled.sql.toLowerCase().replace(/\s+/g, " ");

    expect(lower).toContain('with claimed as ( update "idempotency_keys"');
    expect(lower).toContain("returning blog_id");
    expect(lower).toContain("select blog_id from claimed limit 1");
    expect(lower).toContain("changed as (insert");
    expect(lower).toContain('insert into "action_audit"');
  });

  it("renders a revision-guarded UPDATE and its audit as one statement", () => {
    const updateQuery = qb
      .update(posts)
      .set({ body: "Revised body" })
      .where(
        and(
          eq(posts.id, "p1"),
          eq(posts.blogId, "b1"),
          eq(posts.revision, 9),
          isNull(posts.deletedAt),
        ),
      )
      .returning({ id: posts.id });
    const stmt = sql`
      WITH changed AS ${updateQuery}, audit AS (${audit})
      SELECT id FROM changed
    `;
    const compiled = dialect.sqlToQuery(stmt);
    const lower = compiled.sql.toLowerCase().replace(/\s+/g, " ");

    expect(lower).toContain("with changed as (update");
    expect(lower).not.toContain("as ((update");
    expect(lower).toContain('insert into "action_audit"');
    expect(compiled.params).toContain(9);
  });
});

describe("restore and comment atomic-audit CTEs", () => {
  it("renders restore and its one audit as one guarded statement", () => {
    const changed = qb
      .update(posts)
      .set({ deletedAt: null })
      .where(
        and(
          eq(posts.id, "p1"),
          eq(posts.blogId, "b1"),
          sql`${posts.deletedAt} is not null`,
        ),
      )
      .returning({ id: posts.id });
    const stmt = sql`
      WITH changed AS ${changed}, audit AS (${audit})
      SELECT id FROM changed
    `;
    const compiled = dialect.sqlToQuery(stmt);
    const lower = compiled.sql.toLowerCase().replace(/\s+/g, " ");

    expect(lower).toContain("with changed as (update");
    expect(lower).toContain('"deleted_at" is not null');
    expect(lower.match(/insert into "action_audit"/g)).toHaveLength(1);
    expect(lower).toContain("select id from changed");
  });

  it("renders comment creation and its item-targeted audit as one statement", () => {
    const itemId = "11111111-1111-4111-8111-111111111111";
    const changed = qb
      .insert(itemComments)
      .values({
        postId: itemId,
        body: "Review this",
        authorActorType: "external_agent",
      })
      .returning({ id: itemComments.id });
    const commentAudit = auditCteFrom(
      {
        actorType: "external_agent",
        actionName: "mcp.add_comment",
        targetType: "item",
      },
      "changed",
      sql`${itemId}::text`,
    );
    const stmt = sql`
      WITH changed AS ${changed}, audit AS (${commentAudit})
      SELECT id FROM changed
    `;
    const compiled = dialect.sqlToQuery(stmt);
    const lower = compiled.sql.toLowerCase().replace(/\s+/g, " ");

    expect(lower).toContain("with changed as (insert");
    expect(lower).toContain('insert into "action_audit"');
    expect(lower.match(/insert into "action_audit"/g)).toHaveLength(1);
    expect(compiled.params).toContain(itemId);
  });

  it("gates a resolution audit on the item-scoped comment update", () => {
    const itemId = "11111111-1111-4111-8111-111111111111";
    const changed = qb
      .update(itemComments)
      .set({ resolvedAt: new Date("2026-08-20T00:00:00.000Z") })
      .where(
        and(
          eq(itemComments.id, "comment-1"),
          eq(itemComments.postId, itemId),
        ),
      )
      .returning({ id: itemComments.id });
    const commentAudit = auditCteFrom(
      {
        actorType: "external_agent",
        actionName: "mcp.resolve_comment",
        targetType: "item",
      },
      "changed",
      sql`${itemId}::text`,
    );
    const stmt = sql`
      WITH changed AS ${changed}, audit AS (${commentAudit})
      SELECT id FROM changed
    `;
    const compiled = dialect.sqlToQuery(stmt);
    const lower = compiled.sql.toLowerCase().replace(/\s+/g, " ");

    expect(lower).toContain("with changed as (update");
    expect(lower).toContain('"item_comments"."id"');
    expect(lower).toContain('"item_comments"."post_id"');
    expect(lower.match(/insert into "action_audit"/g)).toHaveLength(1);
    expect(lower).toContain("from \"changed\"");
  });
});
