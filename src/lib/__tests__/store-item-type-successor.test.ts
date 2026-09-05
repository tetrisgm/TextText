import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { validateDocumentSnapshot } from "@/lib/documents/model";

const mocks = vi.hoisted(() => ({ rows: [] as unknown[], conditions: null as unknown }));
vi.mock("@/lib/blog-core", () => ({ getBlogCore: async () => ({ id: "blog-1" }) }));
vi.mock("@/lib/db/client", () => ({ db: {
  select: () => ({ from: () => ({ where: (condition: unknown) => {
    mocks.conditions = condition;
    return { orderBy: async () => mocks.rows };
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
  beforeEach(() => { mocks.rows = []; });
  it("counts only the exact base reference, preserving unrelated and pinned types", async () => {
    mocks.rows = [row("base", base), row("older", { ...base, version: 1 }), row("other", { id: "other", version: 3 }), row("done", successor)];
    const before = structuredClone(mocks.rows);
    // Zero budget exercises the real store's pending selection without a DB write.
    expect(await retemplateFolderItems("shoku", "a", successor, { fromReference: base, limit: 0 })).toEqual({ changed: 0, contested: 0, remaining: 1 });
    expect(mocks.rows).toEqual(before);
    const query = new PgDialect().sqlToQuery(mocks.conditions as SQL);
    expect(query.params).toEqual(expect.arrayContaining(["blog-1", "a"]));
    expect(query.sql).toContain('"posts"."deleted_at" is null');
  });
  it("does nothing when the selected folder has only unrelated items", async () => {
    mocks.rows = [row("other", { id: "other", version: 3 }), row("older", { ...base, version: 2 })];
    expect(await retemplateFolderItems("shoku", "a", successor, { fromReference: base })).toEqual({ changed: 0, contested: 0, remaining: 0 });
  });
  it("keeps a matching item without a revision instead of making an unguarded write", async () => {
    mocks.rows = [{ ...row("base", base), revision: undefined }];
    expect(await retemplateFolderItems("shoku", "a", successor, { fromReference: base })).toEqual({ changed: 0, contested: 1, remaining: 1 });
  });
  it("preserves the separate explicit restyle-all operation", async () => {
    mocks.rows = [row("base", base), row("other", { id: "other", version: 3 }), row("done", successor)];
    expect(await retemplateFolderItems("shoku", "a", successor, { limit: 0 })).toEqual({ changed: 0, contested: 0, remaining: 2 });
  });
});
