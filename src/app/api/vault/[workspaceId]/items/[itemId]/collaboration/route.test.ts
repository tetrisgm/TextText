import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), authorizeMetadata: vi.fn(), read: vi.fn(), wait: vi.fn(), push: vi.fn() }));
vi.mock("@/app/api/vault/scoped-auth", () => ({ authorizeVaultItem: mocks.authorize, authorizeVaultItemAtPath: mocks.authorize,
  authorizeVaultItemUsingMetadata: mocks.authorizeMetadata }));
vi.mock("@/lib/store", () => ({ readVaultCollaboration: mocks.read, waitVaultCollaboration: mocks.wait, pushVaultCollaboration: mocks.push,
  VaultBusyError: class extends Error {}, VaultCollaborationEpochError: class extends Error { constructor(readonly epoch: number) { super("File changed"); } },
  VaultCollaborationRecoveryError: class extends Error { constructor(readonly code: string) { super("Saved edits need review"); } } }));
import { GET, POST } from "./route";
import { VaultCollaborationEpochError, VaultCollaborationRecoveryError } from "@/lib/store";
const url = "https://texttext.test/api/vault/workspace/items/item-1/collaboration";
const context = { params: Promise.resolve({ workspaceId: "workspace", itemId: "item-1" }) };
const identity = { root: "/trusted", workspaceId: "workspace", actorUserId: "user-1", actorType: "human", canEditContent: true, canComment: true, relativePath: "Notes/Shared.textpack" };
const state = { epoch: 1, seq: 2, revision: "a".repeat(64), update: "AAA=", relativePath: "Notes/Shared.textpack" };
const post = (value: unknown) => new Request(url, { method: "POST", headers: { Origin: "https://texttext.test" }, body: JSON.stringify(value) });
const mutation = { operationId: "operation-1", epoch: 1, updates: ["AAA="] };
describe("file collaboration route", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.authorize.mockResolvedValue(identity); mocks.authorizeMetadata.mockResolvedValue(identity); mocks.read.mockResolvedValue(state); mocks.wait.mockResolvedValue(state); mocks.push.mockImplementation(async input => { await input.beforeCommit?.(state.relativePath); return { status: "written", revision: state.revision }; }); });
  it("authorizes before reading or parsing writes", async () => {
    mocks.authorize.mockResolvedValue(new Response(null, { status: 403 }));
    mocks.authorizeMetadata.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await GET(new Request(url), context)).status).toBe(403);
    expect((await POST(post(mutation), context)).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
  });
  it("returns full baseline on initial read and a small cursor-only response when unchanged", async () => {
    const response = await GET(new Request(url), context);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ...state, canEditContent: true, canComment: true });
    const waiting = await GET(new Request(`${url}?epoch=1&seq=2&waitMs=25000`), context);
    expect(await waiting.json()).toEqual({ unchanged: true, epoch: 1, seq: 2, canEditContent: true, canComment: true });
    expect(mocks.wait).toHaveBeenCalledWith(expect.objectContaining({ itemId: "item-1", epoch: 1, seq: 2, waitMs: 25000 }));
    expect(mocks.authorizeMetadata).toHaveBeenCalledTimes(4);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("does not expose a waited result after access is revoked", async () => {
    mocks.authorizeMetadata.mockResolvedValueOnce(identity).mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await GET(new Request(`${url}?epoch=1&seq=2&waitMs=1000`), context)).status).toBe(404);
    expect(mocks.authorizeMetadata).toHaveBeenCalledTimes(2);
  });
  it("rejects a path move after reading collaboration state", async () => {
    mocks.authorizeMetadata.mockResolvedValueOnce(identity)
      .mockResolvedValueOnce({ ...identity, relativePath: "Elsewhere/Moved.textpack" });
    expect((await GET(new Request(url), context)).status).toBe(409);
  });
  it("does not commit an upload after edit access is revoked", async () => {
    mocks.authorize.mockResolvedValueOnce(identity).mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await POST(post(mutation), context)).status).toBe(403);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
  it("uses the authorized actor and reports epoch fencing explicitly", async () => {
    expect((await POST(post({ ...mutation, actorUserId: "attacker", root: "/outside" }), context)).status).toBe(200);
    expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ ...identity, itemId: "item-1", ...mutation, beforeCommit: expect.any(Function) }));
    mocks.push.mockRejectedValue(new VaultCollaborationEpochError(2));
    const conflict = await POST(post(mutation), context);
    expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ epoch: 2, code: "epoch_changed" });
  });
  it("attributes a native shared edit to the app user without granting that claim to manual tokens", async () => {
    const native = { ...identity, actorType: "external_agent" as const, canAttributeNativeEditor: true };
    const request = new Request(url, { method: "POST", headers: { "X-TextText-Edit-Origin": "native-editor" }, body: JSON.stringify(mutation) });
    mocks.authorize.mockResolvedValue(native);
    expect((await POST(request, context)).status).toBe(200);
    expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "user-1", actorType: "human" }));
    mocks.push.mockClear();
    expect((await POST(post(mutation), context)).status).toBe(200);
    expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ actorType: "external_agent" }));
    mocks.push.mockClear();
    mocks.authorize.mockResolvedValue({ ...native, canAttributeNativeEditor: false });
    expect((await POST(request, context)).status).toBe(403);
    expect(mocks.push).not.toHaveBeenCalled();
    expect((await POST(new Request(url, { method: "POST", headers: { "X-TextText-Edit-Origin": "human" }, body: JSON.stringify(mutation) }), context)).status).toBe(400);
  });
  it("rechecks app-token attribution at the commit boundary", async () => {
    const native = { ...identity, actorType: "external_agent" as const, canAttributeNativeEditor: true };
    mocks.authorize.mockResolvedValueOnce(native).mockResolvedValueOnce({ ...native, canAttributeNativeEditor: false });
    const request = new Request(url, { method: "POST", headers: { "X-TextText-Edit-Origin": "native-editor" }, body: JSON.stringify(mutation) });
    expect((await POST(request, context)).status).toBe(403);
  });
  it("passes a fresh authorization check into the store commit boundary", async () => {
    mocks.authorize.mockResolvedValueOnce(identity).mockResolvedValueOnce(new Response(null, { status: 403 }));
    mocks.push.mockImplementation(async (input) => { await input.beforeCommit(state.relativePath); return { status: "written" }; });
    expect((await POST(post(mutation), context)).status).toBe(403);
  });
  it("uses the same fresh edit authorization for epoch recovery and its retries", async () => {
    const recovery = { operationId: "recovery-1", epoch: 1, recoveryUpdate: "AAA=" };
    expect((await POST(post(recovery), context)).status).toBe(200);
    expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ ...recovery, actorUserId: identity.actorUserId }));
    expect(mocks.push.mock.calls[0][0].updates).toBeUndefined();
    mocks.authorize.mockResolvedValueOnce(identity).mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await POST(post(recovery), context)).status).toBe(403);
    mocks.authorize.mockResolvedValue(identity);
    mocks.push.mockRejectedValue(new VaultCollaborationRecoveryError("recovery_lifecycle"));
    const refused = await POST(post(recovery), context);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "recovery_lifecycle" });
  });
  it("rejects ambiguous or malformed recovery payloads", async () => {
    for (const recoveryUpdate of [null, {}, "", 1]) expect((await POST(post({ operationId: "recover", epoch: 1, recoveryUpdate }), context)).status).toBe(400);
    expect((await POST(post({ ...mutation, recoveryUpdate: "AAA=" }), context)).status).toBe(400);
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("rejects malformed cursors, bodies and declared or streamed oversized bodies", async () => {
    for (const query of ["waitMs=25001", "waitMs=1", "epoch=0&seq=1", "epoch=1&seq=-1", "epoch=1&seq=NaN"]) expect((await GET(new Request(`${url}?${query}`), context)).status).toBe(400);
    for (const value of [null, [], {}, { ...mutation, operationId: "../private" }, { ...mutation, epoch: 0 }, { ...mutation, updates: [1] }, { ...mutation, updates: Array(65).fill("AAA=") }]) expect((await POST(post(value), context)).status).toBe(400);
    const declared = new Request(url, { method: "POST", headers: { "Content-Length": String(7 * 1024 * 1024) }, body: "{}" });
    expect((await POST(declared, context)).status).toBe(413);
    expect((await POST(post({ ...mutation, padding: "x".repeat(6 * 1024 * 1024) }), context)).status).toBe(413);
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("suppresses a result after the caller aborts", async () => {
    const abort = new AbortController(); abort.abort();
    expect((await GET(new Request(url, { signal: abort.signal }), context)).status).toBe(204);
  });
});
