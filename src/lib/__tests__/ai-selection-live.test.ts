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

describe("independent source precondition at the live write boundary", () => {
  async function excerptMutation() {
    return {
      textRange: {
        field: "subtitle" as const, start: 0, end: 0,
        expectedText: "", replacementText: "Generated excerpt",
        sourcePrecondition: (await createSelectionEnvelope(id, post, {
          field: "body", start: 0, end: 6, text: "Before",
        }))!,
      },
      operationId: "excerpt-op",
    };
  }
  function loadSnapshot(value: DocumentSnapshot, version = 17) {
    const encoded = Buffer.from(encodeDocumentBaseline(value, `${id}:42`)).toString("base64");
    mocks.select.mockReset();
    mocks.select.mockReturnValueOnce(rows([{ epoch: 1, baselineRevision: 42, baselineUpdate: encoded, materializedRevision: 42 }]))
      .mockReturnValueOnce(rows([{ epoch: 1, revision: 42, update: encoded }]))
      .mockReturnValueOnce(rows([{ mutationVersion: version }]))
      .mockReturnValueOnce(rows([]));
    return encoded;
  }

  it("persists only the excerpt with source revision, document version and audit in one append", async () => {
    const encoded = loadSnapshot(snapshot);
    const result = await applyLiveDocumentMutation(id, await excerptMutation(), audit);
    expect(result).toMatchObject({ snapshot: { content: { body: "Before", subtitle: "Generated excerpt" } }, auditRecorded: true });
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls.at(-1)![0]);
    expect(query.sql).toMatch(/AND mutation_version = \$\d+/);
    expect(query.sql).toMatch(/AND revision = \$\d+/);
    expect(query.sql).toContain("FOR UPDATE");
    expect(query.sql).toContain('INSERT INTO "collab_updates"');
    expect(query.sql).toContain('INSERT INTO "action_audit"');
    expect(query.params).toContain(17);
    expect(query.params).toContain(42);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(encoded, "base64"));
    const delta = query.params.find((value) => typeof value === "string" && value.length > 80 && value !== id) as string;
    Y.applyUpdate(doc, Buffer.from(delta, "base64"));
    expect(documentSnapshotFromYDoc(doc).content).toMatchObject({ body: "Before", subtitle: "Generated excerpt" });
    doc.destroy();
  });

  it.each(["title", "excerpt", "body"] as const)("accepts exact UTF-16 source offsets in %s", async (field) => {
    const text = " 📰 café\n";
    const value = "xx" + text + "tail";
    const item = { ...post, [field]: value };
    const content = { ...snapshot.content, [field === "excerpt" ? "subtitle" : field]: value };
    loadSnapshot({ ...snapshot, content });
    const edit = await excerptMutation();
    edit.textRange.sourcePrecondition = (await createSelectionEnvelope(id, item, { field, start: 2, end: 2 + text.length, text }))!;
    if (field === "excerpt") {
      edit.textRange.end = value.length;
      edit.textRange.expectedText = value;
    }
    const result = await applyLiveDocumentMutation(id, edit, audit);
    expect(result?.snapshot.content.subtitle).toBe("Generated excerpt");
  });

  it.each(["Other!", "XBefore", "Other! Before"])("rejects changed or shifted live source %s despite unchanged canonical body and excerpt", async (body) => {
    loadSnapshot({ ...snapshot, content: { ...snapshot.content, body } });
    await expect(applyLiveDocumentMutation(id, await excerptMutation(), audit)).rejects.toThrow(SELECTION_STALE_ERROR);
    expect(mocks.execute).toHaveBeenCalledTimes(1); // Baseline only, no append/audit.
  });

  it("keeps the destination expected-text guard when the source still matches", async () => {
    loadSnapshot({ ...snapshot, content: { ...snapshot.content, subtitle: "Peer excerpt" } });
    const edit = await excerptMutation();
    edit.textRange.end = 3;
    edit.textRange.expectedText = "Old";
    await expect(applyLiveDocumentMutation(id, edit, audit)).rejects.toThrow("The selected text changed while this command was running.");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("checks both envelopes rather than replacing the destination envelope", async () => {
    const edit = await mutation();
    const sourcePrecondition = (await createSelectionEnvelope(id, { ...post, title: "Other" }, { field: "title", start: 0, end: 5, text: "Other" }))!;
    await expect(applyLiveDocumentMutation(id, { ...edit, textRange: { ...edit.textRange, sourcePrecondition } }, audit)).rejects.toThrow(SELECTION_STALE_ERROR);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it.each(["item", "revision", "hash"])("rejects a mismatched source %s at commit", async (property) => {
    const edit = await excerptMutation();
    if (property === "item") edit.textRange.sourcePrecondition = (await createSelectionEnvelope("other-item", post, { field: "body", start: 0, end: 6, text: "Before" }))!;
    if (property === "revision") mocks.context.mockResolvedValueOnce({ handle: "writer", post }).mockResolvedValueOnce({ handle: "writer", post: { ...post, revision: 43 } });
    if (property === "hash") edit.textRange.sourcePrecondition.hash = "0".repeat(64);
    await expect(applyLiveDocumentMutation(id, edit, audit)).rejects.toThrow(property === "hash" ? "This selection could not be verified" : SELECTION_STALE_ERROR);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("refuses a concurrent commit after validation without retrying or returning the mutated snapshot", async () => {
    // The atomic append returns no row if a peer changed mutation_version,
    // the canonical revision, or the epoch after this document was loaded.
    mocks.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await expect(applyLiveDocumentMutation(id, await excerptMutation(), audit)).rejects.toThrow(SELECTION_STALE_ERROR);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.select).toHaveBeenCalledTimes(4);
  });

  it("requires an audit for source-guarded writes", async () => {
    await expect(applyLiveDocumentMutation(id, await excerptMutation())).rejects.toThrow("requires an audit entry");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});

describe("large live agent writes", () => {
  it("appends bounded rows under one version fence with exactly one audit and receipt", async () => {
    const { MAX_UPDATE_CHARS } = await import("@/lib/collab/limits");
    const body = "😀漢".repeat(200_000);
    const result = await applyLiveDocumentMutation(id, { body, operationId: "large-agent-write" }, audit);
    expect(result).toMatchObject({ snapshot: { content: { body } }, auditRecorded: true, seq: 9 });
    // One baseline preparation statement, then ONE atomic command append.
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls.at(-1)![0]);
    expect(query.sql).toContain("mutation_version =");
    expect(query.sql).toContain("WITH ORDINALITY");
    expect(query.sql).toContain("ORDER BY chunk.ordinal");
    expect(query.sql).toContain("SELECT max(seq) AS seq FROM inserted HAVING count(*) > 0");
    expect(query.sql.match(/INSERT INTO "action_audit"/g)).toHaveLength(1);
    expect(query.sql).toContain("FROM appended");
    const encoded = query.params.find((value) => typeof value === "string" && value.startsWith('["')) as string;
    const updates = JSON.parse(encoded) as string[];
    expect(updates.length).toBeGreaterThan(1);
    const peer = new Y.Doc(); Y.applyUpdate(peer, Buffer.from(baseline, "base64"));
    for (const update of updates) {
      expect(update.length).toBeLessThan(MAX_UPDATE_CHARS);
      Y.applyUpdate(peer, Buffer.from(update, "base64"));
    }
    expect(documentSnapshotFromYDoc(peer).content.body).toBe(body);
    const { applyDocumentMutation } = await import("@/lib/collab/document");
    expect(applyDocumentMutation(peer, { body, operationId: "large-agent-write" })).toBe(false);
    peer.destroy();
  });

  it("does not append any of a rejected large guarded write", async () => {
    const edit = await mutation(); edit.textRange.replacementText = "x".repeat(600_000);
    mocks.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await expect(applyLiveDocumentMutation(id, edit, audit)).rejects.toThrow(SELECTION_STALE_ERROR);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});
