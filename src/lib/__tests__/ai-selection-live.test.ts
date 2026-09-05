import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import * as Y from "yjs";
import { encodeDocumentBaseline, documentSnapshotFromYDoc } from "@/lib/collab/document";
import { createSelectionEnvelope, SELECTION_STALE_ERROR } from "@/lib/ai/selection-envelope";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { AuditEntry } from "@/lib/audit";

const mocks = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { select: mocks.select, execute: mocks.execute } }));
vi.mock("@/lib/store", () => ({ getPostStoreContext: mocks.context }));
vi.mock("@/lib/permissions", () => ({ resolveItemAccess: vi.fn() }));
import { applyLiveDocumentMutation } from "@/lib/collab";

const id = "66666666-6666-4666-8666-666666666666";
const snapshot: DocumentSnapshot = { schemaVersion: 1, content: { title: "Draft", body: "Before", fields: {}, tags: [], assets: [] }, presentation: { template: { id: "texttext.article", version: 1 }, theme: {} } };
const post = { id, revision: 42, title: "Draft", body: "Before", document: snapshot };
const audit: AuditEntry = { actorType: "ai", actionName: "update_item", targetType: "item", targetId: id };
const baseline = Buffer.from(encodeDocumentBaseline(snapshot, `${id}:42`)).toString("base64");

function rows(value: unknown[]) {
  const query = { from: () => query, where: () => query, orderBy: async () => value, limit: async () => value };
  return query;
}
async function mutation() {
  return { textRange: { field: "body" as const, start: 0, end: 6, expectedText: "Before", replacementText: "After", selectionEnvelope: await createSelectionEnvelope(id, post, { field: "body", start: 0, end: 6, text: "Before" }) }, operationId: "selection-op" };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ handle: "writer", post });
  mocks.select.mockReturnValueOnce(rows([{ epoch: 1, baselineRevision: 42, baselineUpdate: baseline, materializedRevision: 42 }]))
    .mockReturnValueOnce(rows([{ epoch: 1, revision: 42, update: baseline }]))
    .mockReturnValueOnce(rows([{ mutationVersion: 0 }]))
    .mockReturnValueOnce(rows([]));
  mocks.execute.mockResolvedValue({ rows: [{ seq: 9 }] });
});

describe("selection apply at the live write boundary", () => {
  it("checks revision and atomically appends the exact range with its audit", async () => {
    const result = await applyLiveDocumentMutation(id, await mutation(), audit);
    expect(result).toMatchObject({ snapshot: { content: { body: "After" } }, auditRecorded: true });
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls.at(-1)![0]);
    expect(query.sql).toContain('INSERT INTO "collab_updates"');
    expect(query.sql).toContain('INSERT INTO "action_audit"');
    expect(query.sql).toContain('revision =');
    expect(query.sql).toContain('FOR UPDATE');
    expect(query.sql).toContain('FROM appended');
    expect(query.params).toContain(42);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(baseline, "base64"));
    // The persisted delta, not merely the returned snapshot, changes the range.
    const delta = query.params.find((value) => typeof value === "string" && value.length > 80 && value !== id) as string;
    Y.applyUpdate(doc, Buffer.from(delta, "base64"));
    expect(documentSnapshotFromYDoc(doc).content.body).toBe("After");
    doc.destroy();
  });

  it("refuses a revision that changed after command validation, before appending", async () => {
    mocks.context.mockResolvedValueOnce({ handle: "writer", post })
      .mockResolvedValueOnce({ handle: "writer", post: { ...post, revision: 43 } });
    await expect(applyLiveDocumentMutation(id, await mutation(), audit)).rejects.toThrow(SELECTION_STALE_ERROR);
    // Baseline initialization is the only SQL execution; no delta or audit.
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale live Yjs range even when canonical revision is unchanged", async () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(baseline, "base64"));
    const vector = Y.encodeStateVector(doc);
    const body = doc.getMap("document").get("body") as Y.Text;
    body.delete(0, 6); body.insert(0, "Other!");
    const delta = Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString("base64");
    mocks.select.mockReset();
    mocks.select.mockReturnValueOnce(rows([{ epoch: 1, baselineRevision: 42, baselineUpdate: baseline, materializedRevision: 42 }]))
      .mockReturnValueOnce(rows([{ epoch: 1, revision: 42, update: baseline }]))
      .mockReturnValueOnce(rows([{ mutationVersion: 0 }]))
      .mockReturnValueOnce(rows([{ update: delta }]));
    await expect(applyLiveDocumentMutation(id, await mutation(), audit)).rejects.toThrow(SELECTION_STALE_ERROR);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    doc.destroy();
  });

  it("refuses a failed append fence without retrying the old envelope", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await expect(applyLiveDocumentMutation(id, await mutation(), audit)).rejects.toThrow(SELECTION_STALE_ERROR);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});
