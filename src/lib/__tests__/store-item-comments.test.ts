import type { SQL } from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { itemComments, posts } from "@/lib/db/schema";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/db/client", () => ({
  get db() {
    return holder.db;
  },
}));

const {
  createItemComment,
  deleteItemComment,
  listItemComments,
  reopenItemComment,
  resolveItemComment,
  setItemCommentResolved,
  updateItemComment,
} = await import("@/lib/store");

const dialect = new PgDialect();
const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const COMMENT_ID = "22222222-2222-4222-8222-222222222222";
const PARENT_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const CREATED_AT = new Date("2026-07-15T12:00:00.000Z");
const UPDATED_AT = new Date("2026-07-15T12:01:00.000Z");

type Call = Record<string, unknown>;

interface FakeState {
  selectRows: Array<Array<Record<string, unknown>>>;
  insertRows: Array<Array<Record<string, unknown>>>;
  updateRows: Array<Array<Record<string, unknown>>>;
  deleteRows: Array<Array<Record<string, unknown>>>;
}

function commentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMENT_ID,
    postId: ITEM_ID,
    parentId: null,
    body: "Review this paragraph",
    anchorField: null,
    anchorQuote: null,
    anchorStart: null,
    anchorEnd: null,
    authorUserId: USER_ID,
    authorName: null,
    authorActorType: "human",
    editedByUserId: null,
    editedByActorType: null,
    resolvedAt: null,
    resolvedByUserId: null,
    resolvedByActorType: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function createFakeDb(state: FakeState) {
  const calls: {
    selects: Call[];
    inserts: Call[];
    updates: Call[];
    deletes: Call[];
  } = { selects: [], inserts: [], updates: [], deletes: [] };

  const db = {
    select(fields?: unknown) {
      return {
        from(table: unknown) {
          return {
            where(cond: unknown) {
              const call: Call = { fields, table, cond };
              calls.selects.push(call);
              return {
                limit(limit: number) {
                  call.limit = limit;
                  return Promise.resolve(state.selectRows.shift() ?? []);
                },
                orderBy(...orderBy: unknown[]) {
                  call.orderBy = orderBy;
                  return Promise.resolve(state.selectRows.shift() ?? []);
                },
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: unknown) {
          const call: Call = { table, values };
          calls.inserts.push(call);
          return {
            returning() {
              return Promise.resolve(state.insertRows.shift() ?? []);
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: unknown) {
          const call: Call = { table, values };
          calls.updates.push(call);
          return {
            where(cond: unknown) {
              call.cond = cond;
              return {
                returning() {
                  return Promise.resolve(state.updateRows.shift() ?? []);
                },
              };
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        where(cond: unknown) {
          const call: Call = { table, cond };
          calls.deletes.push(call);
          return {
            returning() {
              return Promise.resolve(state.deleteRows.shift() ?? []);
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

function setup(state: Partial<FakeState> = {}) {
  const fake = createFakeDb({
    selectRows: state.selectRows ?? [],
    insertRows: state.insertRows ?? [],
    updateRows: state.updateRows ?? [],
    deleteRows: state.deleteRows ?? [],
  });
  holder.db = fake.db;
  return fake;
}

function compiled(cond: unknown) {
  return dialect.sqlToQuery(cond as SQL);
}

beforeEach(() => {
  holder.db = null;
});

describe("item comment schema", () => {
  it("cascades permanent post and parent comment deletion", () => {
    const config = getTableConfig(itemComments);
    const postForeignKey = config.foreignKeys.find(
      (foreignKey) => foreignKey.reference().foreignTable === posts,
    );
    const parentForeignKey = config.foreignKeys.find(
      (foreignKey) => foreignKey.reference().foreignTable === itemComments,
    );

    expect(postForeignKey?.onDelete).toBe("cascade");
    expect(parentForeignKey?.onDelete).toBe("cascade");
  });
});

describe("listItemComments", () => {
  it("includes roots, replies, open, and resolved comments by default", async () => {
    const resolvedAt = new Date("2026-07-15T12:02:00.000Z");
    const { calls } = setup({
      selectRows: [[
        commentRow(),
        commentRow({
          id: "55555555-5555-4555-8555-555555555555",
          parentId: PARENT_ID,
          anchorField: "body",
          anchorQuote: "quoted text",
          anchorStart: 10,
          anchorEnd: 21,
          resolvedAt,
          resolvedByUserId: null,
          resolvedByActorType: "ai",
        }),
      ]],
    });

    const comments = await listItemComments(ITEM_ID);

    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({ resolved: false, parentId: null });
    expect(comments[1]).toMatchObject({
      resolved: true,
      parentId: PARENT_ID,
      anchor: {
        field: "body",
        exactQuote: "quoted text",
        start: 10,
        end: 21,
      },
      resolvedBy: { actorUserId: null, actorType: "ai" },
    });
    const query = compiled(calls.selects[0].cond);
    expect(query.params).toEqual([ITEM_ID]);
    expect(query.sql).not.toContain("resolved_at");
    expect(query.sql).not.toContain("parent_id");
  });

  it("only excludes comments when the caller supplies filters", async () => {
    const { calls } = setup({ selectRows: [[]] });

    await listItemComments(ITEM_ID, { resolved: false, parentId: null });

    const query = compiled(calls.selects[0].cond);
    expect(query.params).toEqual([ITEM_ID]);
    expect(query.sql).toContain("resolved_at\" is null");
    expect(query.sql).toContain("parent_id\" is null");
  });
});

describe("createItemComment", () => {
  it("accepts the one-object actor shape used by action callers", async () => {
    const { calls } = setup({
      insertRows: [[commentRow({ authorName: "Ada" })]],
    });

    expect(createItemComment).toHaveLength(1);
    const created = await (
      createItemComment as unknown as (
        input: Record<string, unknown>,
      ) => Promise<{ authorName: string | null }>
    )({
      postId: ITEM_ID,
      itemId: ITEM_ID,
      authorUserId: USER_ID,
      userId: USER_ID,
      authorName: "Ada",
      body: "Check this",
      parentId: null,
    });

    expect(calls.inserts[0].values).toMatchObject({
      postId: ITEM_ID,
      authorUserId: USER_ID,
      authorName: "Ada",
      authorActorType: "human",
    });
    expect(created.authorName).toBe("Ada");
  });

  it("stores actor and anchored text context and returns the created comment", async () => {
    const stored = commentRow({
      anchorField: "excerpt",
      anchorQuote: "Exact words",
      anchorStart: 4,
      anchorEnd: 15,
      authorUserId: null,
      authorActorType: "external_agent",
    });
    const { calls } = setup({ insertRows: [[stored]] });

    const created = await createItemComment(
      {
        itemId: ITEM_ID,
        body: "Check this claim",
        anchor: {
          field: "excerpt",
          exactQuote: "Exact words",
          start: 4,
          end: 15,
        },
      },
      { actorUserId: null, actorType: "external_agent" },
    );

    expect(calls.inserts[0].table).toBe(itemComments);
    expect(calls.inserts[0].values).toMatchObject({
      postId: ITEM_ID,
      parentId: null,
      body: "Check this claim",
      anchorField: "excerpt",
      anchorQuote: "Exact words",
      anchorStart: 4,
      anchorEnd: 15,
      authorUserId: null,
      authorActorType: "external_agent",
    });
    expect(created).toMatchObject({
      id: COMMENT_ID,
      itemId: ITEM_ID,
      anchor: { field: "excerpt", exactQuote: "Exact words" },
      author: { actorUserId: null, actorType: "external_agent" },
    });
  });

  it("accepts a reply only when its parent is a root on the same item", async () => {
    const { calls } = setup({
      selectRows: [[{ id: PARENT_ID }]],
      insertRows: [[commentRow({ parentId: PARENT_ID })]],
    });

    const reply = await createItemComment(
      { itemId: ITEM_ID, parentId: PARENT_ID, body: "Agreed" },
      { actorUserId: USER_ID, actorType: "human" },
    );

    expect(reply.parentId).toBe(PARENT_ID);
    const parentQuery = compiled(calls.selects[0].cond);
    expect(parentQuery.params).toEqual([PARENT_ID, ITEM_ID]);
    expect(parentQuery.sql).toContain("parent_id\" is null");
    expect(calls.inserts[0].values).toMatchObject({ parentId: PARENT_ID });
  });

  it("rejects a missing, nested, or cross-item parent before insertion", async () => {
    const { calls } = setup({ selectRows: [[]] });

    await expect(
      createItemComment(
        { itemId: ITEM_ID, parentId: PARENT_ID, body: "Reply" },
        { actorType: "human" },
      ),
    ).rejects.toThrow("Parent comment not found");
    expect(calls.inserts).toHaveLength(0);
  });

  it("rejects blank bodies and invalid anchor offsets", async () => {
    const { calls } = setup();

    await expect(
      createItemComment(
        { itemId: ITEM_ID, body: "   " },
        { actorType: "human" },
      ),
    ).rejects.toThrow("Comment body cannot be empty");
    await expect(
      createItemComment(
        {
          itemId: ITEM_ID,
          body: "Comment",
          anchor: { field: "body", exactQuote: "text", start: 8, end: 2 },
        },
        { actorType: "human" },
      ),
    ).rejects.toThrow("end cannot be before");
    expect(calls.inserts).toHaveLength(0);
  });
});

describe("item comment mutations", () => {
  it("edits body/context with actor metadata and item scoping", async () => {
    const stored = commentRow({
      body: "Updated comment",
      editedByUserId: USER_ID,
      editedByActorType: "ai",
    });
    const { calls } = setup({ updateRows: [[stored]] });

    const updated = await updateItemComment(
      ITEM_ID,
      COMMENT_ID,
      { body: "Updated comment", anchor: null },
      { actorUserId: USER_ID, actorType: "ai" },
    );

    expect(calls.updates[0].values).toMatchObject({
      body: "Updated comment",
      anchorField: null,
      anchorQuote: null,
      anchorStart: null,
      anchorEnd: null,
      editedByUserId: USER_ID,
      editedByActorType: "ai",
      updatedAt: expect.any(Date),
    });
    expect(compiled(calls.updates[0].cond).params).toEqual([
      COMMENT_ID,
      ITEM_ID,
    ]);
    expect(updated.editedBy).toEqual({ actorUserId: USER_ID, actorType: "ai" });
  });

  it("resolves and reopens while retaining the responsible actor", async () => {
    const resolvedAt = new Date("2026-07-15T12:05:00.000Z");
    const { calls } = setup({
      updateRows: [
        [
          commentRow({
            resolvedAt,
            resolvedByUserId: USER_ID,
            resolvedByActorType: "human",
          }),
        ],
        [commentRow()],
      ],
    });

    const resolved = await resolveItemComment(ITEM_ID, COMMENT_ID, {
      actorUserId: USER_ID,
      actorType: "human",
    });
    const reopened = await reopenItemComment(ITEM_ID, COMMENT_ID, {
      actorUserId: USER_ID,
      actorType: "human",
    });

    expect(resolved).toMatchObject({
      resolved: true,
      resolvedBy: { actorUserId: USER_ID, actorType: "human" },
    });
    expect(calls.updates[0].values).toMatchObject({
      resolvedAt: expect.any(Date),
      resolvedByUserId: USER_ID,
      resolvedByActorType: "human",
    });
    expect(reopened).toMatchObject({ resolved: false, resolvedBy: null });
    expect(calls.updates[1].values).toMatchObject({
      resolvedAt: null,
      resolvedByUserId: null,
      resolvedByActorType: null,
    });
  });

  it("accepts the one-object resolution shape used by action callers", async () => {
    const resolvedAt = new Date("2026-07-15T12:06:00.000Z");
    const { calls } = setup({
      updateRows: [[
        commentRow({
          resolvedAt,
          resolvedByUserId: USER_ID,
          resolvedByActorType: "human",
        }),
      ]],
    });

    expect(setItemCommentResolved).toHaveLength(1);
    const resolved = await (
      setItemCommentResolved as unknown as (
        input: Record<string, unknown>,
      ) => Promise<{ resolved: boolean }>
    )({
      postId: ITEM_ID,
      itemId: ITEM_ID,
      commentId: COMMENT_ID,
      id: COMMENT_ID,
      resolved: true,
      resolvedByUserId: USER_ID,
      actorUserId: USER_ID,
    });

    expect(resolved.resolved).toBe(true);
    expect(calls.updates[0].values).toMatchObject({
      resolvedByUserId: USER_ID,
      resolvedByActorType: "human",
    });
  });

  it("returns a deleted row so callers can audit the item and comment", async () => {
    const { calls } = setup({ deleteRows: [[commentRow()]] });

    const deleted = await deleteItemComment(ITEM_ID, COMMENT_ID, {
      actorUserId: USER_ID,
      actorType: "human",
    });

    expect(deleted).toMatchObject({ id: COMMENT_ID, itemId: ITEM_ID });
    expect(calls.deletes[0].table).toBe(itemComments);
    expect(compiled(calls.deletes[0].cond).params).toEqual([
      COMMENT_ID,
      ITEM_ID,
    ]);
  });
});
