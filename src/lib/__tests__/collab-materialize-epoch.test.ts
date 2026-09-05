import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { PgDialect } from "drizzle-orm/pg-core";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { applyDocumentBaseline, documentText, encodeDocumentBaseline } from "@/lib/collab/document";

const mocks = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { select: mocks.select, execute: mocks.execute } }));
vi.mock("@/lib/store", () => ({ getPostStoreContext: mocks.context }));
import { CollabEpochConflictError, materializeCollabDocument, prepareCollabBaseline } from "@/lib/collab";

const current = emptyDocumentSnapshot();
current.content.body = "New authoritative body";
const baseline = Buffer.from(encodeDocumentBaseline(current, "probe:3")).toString("base64");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ post: { id: "probe", revision: 3, document: current } });
  mocks.execute.mockResolvedValue({ rows: [] });
  const state = { epoch: 7, revision: 3, update: baseline, baselineRevision: 3, baselineUpdate: baseline, materializedRevision: 3 };
  mocks.select.mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: async () => [state], orderBy: async () => [] }) }),
  }));
});

describe("materializer rejects client state before Yjs application", () => {
  it.each([undefined, -1, 0.5, NaN])("requires a learned epoch (%s)", async (epoch) => {
    await expect(materializeCollabDocument("probe", "invalid Yjs", epoch)).rejects.toBeInstanceOf(CollabEpochConflictError);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("rejects stale epochs even when the supplied Yjs bytes are invalid", async () => {
    // If the bytes were applied first, their decode failure would return null.
    await expect(materializeCollabDocument("probe", "invalid Yjs", 6)).rejects.toBeInstanceOf(CollabEpochConflictError);
  });

  it("cannot resurrect an independently seeded retired document", async () => {
    const retired = new Y.Doc();
    applyDocumentBaseline(retired, { ...current, content: { ...current.content, body: "RETIRED WORDS" } }, "probe:2");
    const state = Buffer.from(Y.encodeStateAsUpdate(retired)).toString("base64");
    await expect(materializeCollabDocument("probe", state, 6)).rejects.toBeInstanceOf(CollabEpochConflictError);
    expect((await materializeCollabDocument("probe"))?.content.body).toBe("New authoritative body");
    retired.destroy();
  });

  it("merges current-generation queued edits, with their learned epoch", async () => {
    const local = new Y.Doc();
    Y.applyUpdate(local, Buffer.from(baseline, "base64"));
    documentText(local, "body").insert(0, "Local ");
    const state = Buffer.from(Y.encodeStateAsUpdate(local)).toString("base64");
    expect((await materializeCollabDocument("probe", state, 7))?.content.body).toBe("Local New authoritative body");
    local.destroy();
  });

  it("returns no document on invalid current-generation state", async () => {
    expect(await materializeCollabDocument("probe", "invalid Yjs", 7)).toBeNull();
  });
});


it("rotation checks the provenance it read before waiting on the materialization lock", async () => {
  mocks.select.mockImplementationOnce(() => ({ from: () => ({ where: () => ({ limit: async () => [{
    epoch: 7, baselineRevision: 2, baselineUpdate: baseline, materializedRevision: 2,
  }] }) }) }));
  mocks.select.mockImplementationOnce(() => ({ from: () => ({ where: async () => [] }) }));
  await prepareCollabBaseline("probe");
  const compiled = new PgDialect().sqlToQuery(mocks.execute.mock.calls[1][0]);
  const sql = compiled.sql.toLowerCase().replace(/\s+/g, " ");
  expect(sql).toContain("and materialized_revision is not distinct from");
  expect(sql).toContain('select 1 from "posts" where id =');
  expect(compiled.params).toContain(2);
  expect(compiled.params).toContain(3);
});
