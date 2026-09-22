import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { validateDocumentSnapshot } from "@/lib/documents/model";

const mocks = vi.hoisted(() => ({ rows: [] as unknown[], conditions: null as unknown, count: 0, limit: vi.fn() }));
vi.mock("@/lib/blog-core", () => ({ getBlogCore: async () => ({ id: "blog-1" }) }));
vi.mock("@/lib/db/client", () => ({ db: {
  select: (projection?: unknown) => ({ from: () => ({ where: (condition: unknown) => {
    mocks.conditions = condition;
    if (projection) return Promise.resolve([{ count: mocks.count }]);
    return { orderBy: () => ({ limit: mocks.limit }) };
  } }) }),
} }));

import { retemplateFolderItems } from "@/lib/store";
const base = { id: "tasks", version: 3 };
const successor = { id: "tasks", version: 4 };
function row(id: string, reference: typeof base, revision: number | undefined = 5) {
  return {
    id, type: "note", visibility: "private", status: "draft", slug: id,
    title: id, body: "Original body", tags: [], folderId: "a", revision,
    createdAt: new Date("2026-09-01"), updatedAt: new Date("2026-09-01"),
    document: validateDocumentSnapshot({ schemaVersion: 1, content: { title: id, body: "Original body", fields: { status: "todo" } }, presentation: { template: reference } }),
  };
}

describe("store successor item selection", () => {
  beforeEach(() => { mocks.rows = []; mocks.count = 0; mocks.limit.mockReset().mockImplementation(async () => mocks.rows); });
  it("pushes exact canonical references and scope into SQL before reading bodies", async () => {
    mocks.count = 501;
    expect(await retemplateFolderItems("shoku", "a", successor, { fromReference: base, limit: 0 })).toEqual({ changed: 0, contested: 0, remaining: 501 });
    expect(mocks.limit).not.toHaveBeenCalled();
    const query = new PgDialect().sqlToQuery(mocks.conditions as SQL);
    expect(query.params).toEqual(expect.arrayContaining(["blog-1", "a", "tasks", "3", "4"]));
    expect(query.sql).toContain('"posts"."deleted_at" is null');
    expect(query.sql).toContain("{presentation,template,id}");
    expect(query.sql).toContain("{presentation,template,version}");
  });
  it("does not load bodies when nothing remains", async () => {
    expect(await retemplateFolderItems("shoku", "a", successor, { fromReference: base })).toEqual({ changed: 0, contested: 0, remaining: 0 });
    expect(mocks.limit).not.toHaveBeenCalled();
  });
  it("caps reads at 500 and keeps a row without a revision instead of writing unguarded", async () => {
    mocks.count = 700;
    mocks.rows = [{ ...row("base", base), revision: undefined }];
    expect(await retemplateFolderItems("shoku", "a", successor, { fromReference: base, limit: 5000 })).toEqual({ changed: 0, contested: 1, remaining: 700 });
    expect(mocks.limit).toHaveBeenCalledWith(500);
  });
  it("preserves the separate explicit restyle-all operation", async () => {
    mocks.count = 2;
    expect(await retemplateFolderItems("shoku", "a", successor, { limit: 0 })).toEqual({ changed: 0, contested: 0, remaining: 2 });
    const query = new PgDialect().sqlToQuery(mocks.conditions as SQL);
    expect(query.params).not.toContain("3");
  });
});
