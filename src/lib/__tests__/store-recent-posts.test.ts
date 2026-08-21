import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQLWrapper } from "drizzle-orm";

const mocks = vi.hoisted(() => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  const state: {
    limit: number | null;
    order: SQLWrapper[];
    where: SQLWrapper | null;
  } = { limit: null, order: [], where: null };
  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.leftJoin = vi.fn(() => query);
  query.where = vi.fn((condition: SQLWrapper) => {
    state.where = condition;
    return query;
  });
  query.orderBy = vi.fn((...clauses: SQLWrapper[]) => {
    state.order = clauses;
    return query;
  });
  query.limit = vi.fn(async (limit: number) => {
    state.limit = limit;
    return [];
  });
  return {
    accessiblePostIdsForUser: vi.fn(),
    query,
    select: vi.fn(() => query),
    state,
  };
});

vi.mock("@/lib/db/client", () => ({
  db: { select: mocks.select },
}));
vi.mock("@/lib/permissions", () => ({
  accessibleFolderIdsForUser: vi.fn(async () => new Set<string>()),
  accessiblePostIdsForUser: mocks.accessiblePostIdsForUser,
}));

import { getAccessibleRecentPosts } from "@/lib/store";

const dialect = new PgDialect();
const visibleItemId = "11111111-1111-4111-8111-111111111111";

function compile(value: SQLWrapper): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(sql`${value}`);
}

describe("getAccessibleRecentPosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.limit = null;
    mocks.state.order = [];
    mocks.state.where = null;
    mocks.accessiblePostIdsForUser.mockResolvedValue(new Set([visibleItemId]));
  });

  it("pushes tenant, access, folder, newest-first order, and the hard cap into SQL", async () => {
    await getAccessibleRecentPosts(
      "demo-blog",
      { userId: "editor-1" },
      { folderPath: "notes", limit: 500 },
    );

    expect(mocks.accessiblePostIdsForUser).toHaveBeenCalledWith("demo-blog", {
      userId: "editor-1",
    });
    expect(mocks.state.limit).toBe(12);

    const where = compile(mocks.state.where!);
    const normalizedWhere = where.sql.toLowerCase().replace(/\s+/g, " ");
    expect(normalizedWhere).toContain('"blogs"."handle" =');
    expect(normalizedWhere).toContain('"posts"."id" in');
    expect(normalizedWhere).toContain('"folders"."path" =');
    expect(where.params).toEqual(
      expect.arrayContaining(["demo-blog", visibleItemId, "notes"]),
    );

    expect(
      mocks.state.order.map((clause) =>
        compile(clause).sql.toLowerCase().replace(/\s+/g, " "),
      ),
    ).toEqual([
      '"posts"."updated_at" desc',
      '"posts"."created_at" desc',
      '"posts"."id" desc',
    ]);
  });

  it("does not query item rows when the access scope is empty", async () => {
    mocks.accessiblePostIdsForUser.mockResolvedValueOnce(new Set());

    await expect(
      getAccessibleRecentPosts("demo-blog", { userId: "viewer-1" }),
    ).resolves.toEqual([]);

    expect(mocks.select).not.toHaveBeenCalled();
  });
});
