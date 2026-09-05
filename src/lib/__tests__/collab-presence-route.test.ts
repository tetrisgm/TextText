import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { decodePresenceAwareness as decode, encodePresenceAwareness as encode } from "@/lib/collab/presence-awareness";
import { PRESENCE_SESSION_MS } from "@/lib/collab/presence-session.server";
const mocks = vi.hoisted(() => ({
  access: vi.fn(), activePresence: vi.fn(), removePresence: vi.fn(), upsertPresence: vi.fn(),
}));
vi.mock("@/lib/collab/access.server", () => ({ getCollabRequestAccess: mocks.access }));
vi.mock("@/lib/collab", () => mocks);
import { GET, POST } from "@/app/api/collab/[postId]/presence/route";
const postId = "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60";
const context = { params: Promise.resolve({ postId }) };
const viewer = {
  role: "viewer", trashed: false, capability: null,
  user: { sub: "viewer-sub", userId: "10000000-0000-4000-8000-000000000001" },
  userName: "Ada", color: "#112233",
};
function request(body: unknown): Request {
  return new Request(`http://localhost/api/collab/${postId}/presence`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
async function join(awarenessClientId = 17, extra = {}) {
  const response = await POST(request({ join: true, awarenessClientId, ...extra }), context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  return (await response.json()).session as { clientId: string; sessionCredential: string; expiresAt: number };
}
function update(clientId = 17, state: Record<string, unknown> | null = {}, clock = 1) {
  return encode(clientId, clock, state);
}
function position() {
  const doc = new Y.Doc();
  const result = Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(doc.getText("body"), 0))).toString("base64");
  doc.destroy();
  return result;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AI_CONFIG_ENCRYPTION_KEY", "presence-tests-only-encryption-key");
  mocks.access.mockResolvedValue(viewer);
  mocks.activePresence.mockResolvedValue([]);
  mocks.upsertPresence.mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("collaboration presence ownership", () => {
  it("lets viewers read without issuing or exposing a credential", async () => {
    const res = await GET(new Request("http://localhost"), context);
    expect(await res.json()).toEqual({ presence: [] });
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(mocks.upsertPresence).not.toHaveBeenCalled();
  });
  it("issues distinct server IDs even when a viewer asks for a victim's ID", async () => {
    const first = await join();
    const second = await join(17, { clientId: first.clientId });
    expect(second.clientId).not.toBe(first.clientId);
    expect(mocks.upsertPresence).not.toHaveBeenCalled();
  });
  it.each([false, true])("rejects another account using a copied credential (leave=%s)", async (leave) => {
    const session = await join();
    mocks.access.mockResolvedValue({ ...viewer, user: { sub: "attacker" } });
    expect((await POST(request({ ...session, leave, awareness: update() }), context)).status).toBe(409);
    expect(mocks.upsertPresence).not.toHaveBeenCalled();
    expect(mocks.removePresence).not.toHaveBeenCalled();
  });
  it.each([false, true])("rejects missing, tampered, swapped and cross-item credentials (leave=%s)", async (leave) => {
    const session = await join();
    const other = await join();
    for (const body of [
      { clientId: session.clientId, leave },
      { ...session, sessionCredential: `${session.sessionCredential}x`, leave },
      { ...session, clientId: other.clientId, leave },
    ]) expect((await POST(request(body), context)).status).toBe(409);
    expect((await POST(request({ ...session, leave }), { params: Promise.resolve({ postId: "another-item" }) })).status).toBe(409);
    expect(mocks.upsertPresence).not.toHaveBeenCalled();
    expect(mocks.removePresence).not.toHaveBeenCalled();
  });
  it("accepts a viewer's own leave and attributes its audit", async () => {
    const session = await join();
    expect((await POST(request({ ...session, leave: true }), context)).status).toBe(200);
    expect(mocks.removePresence).toHaveBeenCalledWith(postId, session.clientId, expect.objectContaining({
      actorUserId: viewer.user.userId, actionName: "collab.presence.leave", targetId: postId,
    }));
  });
  it("binds guests to the exact capability and fails closed without a principal", async () => {
    mocks.access.mockResolvedValue({ ...viewer, user: null, capability: { id: "cap-1" } });
    const session = await join();
    expect((await POST(request(session), context)).status).toBe(200);
    mocks.upsertPresence.mockClear();
    mocks.access.mockResolvedValue({ ...viewer, user: null, capability: { id: "cap-2" } });
    expect((await POST(request(session), context)).status).toBe(409);
    mocks.access.mockResolvedValue({ ...viewer, user: null });
    expect((await POST(request(session), context)).status).toBe(403);
    expect(mocks.upsertPresence).not.toHaveBeenCalled();
  });
  it("rechecks access and refuses expired credentials", async () => {
    const session = await join();
    mocks.access.mockResolvedValue({ ...viewer, role: null });
    expect((await POST(request(session), context)).status).toBe(403);
    expect((await GET(new Request("http://localhost"), context)).status).toBe(403);
    mocks.access.mockResolvedValue({ ...viewer, role: null, trashed: true });
    expect((await POST(request(session), context)).status).toBe(410);
    mocks.access.mockResolvedValue(viewer);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + PRESENCE_SESSION_MS + 1);
    expect((await POST(request(session), context)).status).toBe(409);
    expect(mocks.upsertPresence).not.toHaveBeenCalled();
  });
});
describe("bounded and attributed awareness", () => {
  it.each(["editor", "viewer"])("stamps %s identity and drops forged agent/focus metadata", async (role) => {
    mocks.access.mockResolvedValue({ ...viewer, role });
    const session = await join();
    const selection = { field: "body", anchor: position(), head: position() };
    expect((await POST(request({ ...session, userName: "Victim", color: "red", awareness: update(17, {
      user: { clientId: "victim", participantType: "agent", provider: "codex", name: "Victim" },
      focus: { targetUserId: "victim" }, selection, arbitrary: { nested: "payload" },
    }) }), context)).status).toBe(200);
    const [, entry, audit] = mocks.upsertPresence.mock.calls[0];
    expect(entry.userName).toBe("Ada");
    const decoded = decode(entry.awareness);
    expect(decoded.clientId).not.toBe(17);
    expect(decoded.state).toEqual({ user: {
      clientId: session.clientId, name: "Ada", color: "#112233", participantType: "person", role,
    }, selection });
    expect(audit).toMatchObject({ actorUserId: viewer.user.userId, actionName: "collab.presence.update" });
  });
  it("cannot claim a victim's wire ID even by registering that numeric ID", async () => {
    const victim = await join();
    await POST(request({ ...victim, awareness: update() }), context);
    const victimId = decode(mocks.upsertPresence.mock.calls[0][1].awareness).clientId;
    const attacker = await join(victimId);
    await POST(request({ ...attacker, awareness: update(victimId, { user: { clientId: victim.clientId } }, 100000) }), context);
    const forged = decode(mocks.upsertPresence.mock.calls[1][1].awareness);
    expect(forged.clientId).not.toBe(victimId);
    expect(forged.state?.user).toMatchObject({ clientId: attacker.clientId });
  });
  it("accepts omitted and null awareness as identity-only presence", async () => {
    const session = await join();
    for (const awareness of [undefined, null, update(17, null)]) {
      expect((await POST(request({ ...session, awareness }), context)).status).toBe(200);
    }
    expect(mocks.upsertPresence).toHaveBeenCalledTimes(3);
  });
  it("rejects wrong IDs, multi-client, trailing, invalid, oversized and malformed selection updates", async () => {
    const session = await join();
    const multiple = Buffer.from(update(), "base64"); multiple[0] = 2;
    for (const awareness of [
      update(99), multiple.toString("base64"), update() + "AAAA", "!invalid!", 123,
      "A".repeat(16388), update(17, {}, 0x100000000),
      update(17, { selection: { field: "body", anchor: "bad", head: "bad" } }),
      update(17, { selection: { field: ["body"], anchor: position(), head: position() } }),
      update(17, { selection: { field: "other", anchor: position(), head: position() } }),
      update(17, { selection: { field: "body", anchor: position() + "AAAA", head: position() } }),
    ]) expect((await POST(request({ ...session, awareness }), context)).status).toBe(400);
    expect(mocks.upsertPresence).not.toHaveBeenCalled();
  });
  it.each([null, [], 4, "body"])("rejects a non-object body: %s", async (body) => {
    expect((await POST(request(body), context)).status).toBe(400);
  });
  it.each([-1, 1.5, "17", null])("rejects invalid registration IDs: %s", async (awarenessClientId) => {
    expect((await POST(request({ join: true, awarenessClientId }), context)).status).toBe(400);
  });
  it("rejects declared and streamed oversized bodies before storage", async () => {
    const oversized = request({});
    oversized.headers.set("content-length", String(96 * 1024 + 1));
    expect((await POST(oversized, context)).status).toBe(413);
    const streamed = new Request("http://localhost", {
      method: "POST", body: new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(96 * 1024 + 1)); controller.close();
      } }), duplex: "half",
    } as RequestInit & { duplex: string });
    expect((await POST(streamed, context)).status).toBe(413);
    expect(mocks.upsertPresence).not.toHaveBeenCalled();
  });
});
