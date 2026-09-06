import { beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
const m = vi.hoisted(() => ({ access: vi.fn(), append: vi.fn(), presence: vi.fn(), save: vi.fn(), materialize: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/collab/access.server", () => ({ getCollabRequestAccess: m.access }));
vi.mock("@/lib/collab/presence-session.server", () => ({ verifyPresenceSession: vi.fn(), issuePresenceSession: vi.fn() }));
vi.mock("@/lib/collab", () => ({
  appendCollabUpdate: m.append, collabUpdatesSince: vi.fn(async () => []),
  getCollabBaseline: vi.fn(async () => ({ epoch: 0, update: "unused", revision: 1 })), getCollabEpoch: vi.fn(async () => 0),
  latestCollabSeq: vi.fn(async () => 1), maybeCompactCollab: vi.fn(async () => {}),
  prepareCollabBaseline: vi.fn(), activePresence: m.presence, removePresence: vi.fn(), upsertPresence: vi.fn(),
  CollabEpochConflictError: class extends Error {}, materializeCollabDocument: m.materialize,
}));
vi.mock("@/lib/store", () => ({ getPostById: m.post, getUserIdBySub: vi.fn(), savePost: m.save, getBlog: vi.fn(async () => null), PostConflictError: class extends Error {} }));
vi.mock("@/lib/revalidate-blog", () => ({ revalidateBlogPaths: vi.fn() }));
import { GET as readRelay, POST as relay } from "@/app/api/collab/[postId]/route";
import { GET as presence, POST as presencePost } from "@/app/api/collab/[postId]/presence/route";
import { POST as materialize } from "@/app/api/collab/[postId]/materialize/route";
const id = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ postId: id }) };
let allowed = true;
beforeEach(() => {
  vi.resetAllMocks(); allowed = true;
  m.access.mockImplementation(async () => ({ role: allowed ? "editor" : null, trashed: false, user: { sub: "editor", userId: "editor" } }));
  m.append.mockResolvedValue({ seq: 1 });
  const document = emptyDocumentSnapshot();
  m.post.mockResolvedValue({ id, slug: "draft", document, revision: 1 });
  const next = structuredClone(document); next.content.body = "Revoked writer's text";
  m.materialize.mockResolvedValue(next); m.save.mockResolvedValue({ document: next, revision: 2 });
});
function heldBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const request = new Request("http://localhost/api/collab/" + id, {
    method: "POST", body: new ReadableStream<Uint8Array>({ start(c) { controller = c; } }), duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, finish(body: unknown) { controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); controller.close(); } };
}
async function tick() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
it("F1: rejects a relay push revoked while its body is uploading", async () => {
  const upload = heldBody(); const result = relay(upload.request, ctx); await tick();
  expect(m.access).toHaveBeenCalledOnce(); allowed = false;
  const doc = new Y.Doc(); doc.getText("body").insert(0, "revoked edit");
  upload.finish({ epoch: 0, updates: [Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64")] }); doc.destroy();
  const response = await result;
  expect.soft(response.status).toBe(403); expect(m.append).not.toHaveBeenCalled();
});
it("F1: rejects materialization revoked while its body is uploading", async () => {
  const upload = heldBody(); const result = materialize(upload.request, ctx); await tick();
  expect(m.access).toHaveBeenCalledOnce(); allowed = false;
  upload.finish({ epoch: 0, handle: "writer", state: "valid-state-fixture" });
  const response = await result;
  expect.soft(response.status).toBe(403); expect(m.save).not.toHaveBeenCalled();
});
it("control: presence POST rechecks after consuming a delayed body", async () => {
  const upload = heldBody(); const result = presencePost(upload.request, ctx); await tick();
  expect(m.access).not.toHaveBeenCalled(); allowed = false;
  upload.finish({ join: true, awarenessClientId: 1 });
  expect((await result).status).toBe(403);
});
it("F2: withholds presence fetched after a grant was revoked", async () => {
  let finish!: (rows: unknown[]) => void;
  m.presence.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const result = presence(new Request("http://localhost"), ctx); await tick();
  expect(m.presence).toHaveBeenCalledOnce(); allowed = false;
  finish([{ userName: "New private collaborator", awareness: "private selection" }]);
  const response = await result;
  expect.soft(response.status).toBe(403);
  expect(await response.text()).not.toContain("New private collaborator");
});

it("F8: a relay read reports Trash when access is lost at its final recheck", async () => {
  m.access.mockResolvedValueOnce({ role: "viewer", trashed: false })
    .mockResolvedValue({ role: null, trashed: true });
  const response = await readRelay(new Request("http://localhost?since=1"), ctx);
  expect.soft(response.status).toBe(410);
  expect(await response.json()).toMatchObject({ reason: "trashed" });
});
it("F8: a presence read preserves the terminal Trash reason", async () => {
  m.access.mockResolvedValue({ role: null, trashed: true });
  const response = await presence(new Request("http://localhost"), ctx);
  expect.soft(response.status).toBe(410);
  expect(await response.json()).toMatchObject({ reason: "trashed" });
});
