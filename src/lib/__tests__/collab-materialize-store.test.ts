import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { posts } from "@/lib/db/schema";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import type { Post } from "@/lib/content";

const mocks = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/neon-http");
  const qb = drizzle((() => {}) as never);
  return { db: { select: mocks.select, execute: mocks.execute, update: qb.update.bind(qb) } };
});
vi.mock("@/lib/blog-core", () => ({ getBlogCore: async () => ({ id: "blog" }) }));
import { PostConflictError, savePost } from "@/lib/store";

const document = emptyDocumentSnapshot();
document.content.body = "Accepted local words";
const post: Post = {
  id: "11111111-1111-4111-8111-111111111111", slug: "note", title: "Note", type: "note",
  body: document.content.body, folderId: "folder", revision: 3, document, visibility: "private", status: "draft",
};
const options = { expectedRevision: 3, expectedCollabEpoch: 7, preservePublishedAt: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockImplementation(() => ({
    from: (table: unknown) => ({ where: () => ({ limit: async () => table === posts ? [{
      ...post, blogId: "blog", createdAt: new Date(), updatedAt: new Date(),
      publishedAt: null, templateId: document.presentation.template.id, templateVersion: 1,
    }] : [{ id: "folder", name: "Notes", path: "notes", mode: "notes", position: 0 }] }) }),
  }));
  mocks.execute.mockResolvedValue({ rows: [{ id: post.id, revision: "4" }] });
});

describe("audited materialization persistence fence", () => {
  it("locks the generation and writes content, audit and provenance in one statement", async () => {
    const saved = await savePost("demo", { ...post, visibility: "public" }, options);
    expect(saved.document).toEqual(document);
    expect(saved.revision).toBe(4);
    expect(saved.visibility).toBe("private"); // Notes fail closed even with public requested.
    expect(mocks.execute).toHaveBeenCalledOnce();
    const compiled = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    const sql = compiled.sql.toLowerCase().replace(/\s+/g, " ");
    expect(sql).toContain('with locked_epoch as materialized ( select epoch from "collab_state"');
    expect(sql).toContain("for update");
    expect(sql).toContain("changed as (update");
    expect(sql).toContain("select 1 from locked_epoch where epoch =");
    expect(sql).toContain('"posts"."revision" =');
    expect(sql).toContain('insert into "action_audit"');
    expect(sql).toContain('update "collab_state" set materialized_revision = changed.revision');
    expect(sql).toContain("from changed where post_id = changed.id and epoch =");
    expect(compiled.params).toContain(7);
    expect(compiled.params).toContain(3);
    // No post-save re-read can accidentally acknowledge a later writer's state.
    expect(mocks.select).toHaveBeenCalledTimes(3);
  });

  it("a generation or revision conflict never falls through to an unfenced save", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await expect(savePost("demo", post, options)).rejects.toBeInstanceOf(PostConflictError);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it.each([
    { ...options, expectedRevision: undefined },
    { ...options, expectedCollabEpoch: -1 },
    { ...options, auditAlreadyRecorded: true },
  ])("fails closed on an incomplete materialization guard", async (invalid) => {
    await expect(savePost("demo", post, invalid)).rejects.toBeInstanceOf(PostConflictError);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
