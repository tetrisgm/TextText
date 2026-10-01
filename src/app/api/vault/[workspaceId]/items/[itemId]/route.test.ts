import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), authMetadata: vi.fn(), read: vi.fn(), preview: vi.fn(), write: vi.fn(), move: vi.fn(), remove: vi.fn() }));
vi.mock("@/app/api/vault/scoped-auth", () => ({ authorizeVaultItem: mocks.auth, authorizeVaultItemAtPath: mocks.auth,
  authorizeVaultItemUsingMetadata: mocks.authMetadata }));
vi.mock("@/lib/store", () => ({
  readVaultTextpack: mocks.read,
  readVaultPreview: mocks.preview,
  writeVaultTextpack: mocks.write,
  moveVaultTextpack: mocks.move,
  deleteVaultTextpack: mocks.remove,
  VaultBusyError: class extends Error {},
}));
import { GET, PUT, PATCH, DELETE } from "./route";

const context = () => ({ params: Promise.resolve({ workspaceId: "owner-workspace", itemId: "item-1" }) });
const headers = {
  "X-TextText-Operation-Id": "operation-1",
  "X-TextText-Path": encodeURIComponent("Notes/A note.textpack"),
  "If-None-Match": "*",
};

describe("workspace vault API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", "/tmp/test-vault");
    mocks.auth.mockResolvedValue({ root: "/tmp/test-vault", workspaceId: "owner-workspace", actorUserId: "user-1", actorType: "external_agent", fullAccess: true, relativePath: "Notes/A note.textpack" });
    mocks.authMetadata.mockResolvedValue({ root: "/tmp/test-vault", workspaceId: "owner-workspace", actorUserId: "user-1", actorType: "external_agent", fullAccess: true, relativePath: "Notes/A note.textpack" });
  });

  it("rejects unauthenticated reads and cross-workspace writes before file access", async () => {
    mocks.authMetadata.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect((await GET(new Request("https://texttext.test"), context())).status).toBe(401);
    mocks.auth.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await PUT(new Request("https://texttext.test", { method: "PUT", headers, body: "pack" }), {
      params: Promise.resolve({ workspaceId: "someone-else", itemId: "item-1" }),
    })).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("allows collaborator reads but requires edit access for every mutation", async () => {
    mocks.authMetadata.mockResolvedValue({ root: "/tmp/test-vault", workspaceId: "owner-workspace", actorUserId: "viewer", actorType: "human", fullAccess: true, relativePath: "Note.textpack" });
    mocks.auth.mockResolvedValue(new Response(null, { status: 403 }));
    mocks.read.mockResolvedValue({ bytes: new Uint8Array([1]), revision: "a".repeat(64), relativePath: "Note.textpack" });
    expect((await GET(new Request("https://texttext.test"), context())).status).toBe(200);
    for (const [method, handler] of [["PUT", PUT], ["PATCH", PATCH], ["DELETE", DELETE]] as const) {
      expect((await handler(new Request("https://texttext.test", { method, headers }), context())).status).toBe(403);
    }
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.move).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("rechecks edit permission after reading an upload", async () => {
    mocks.auth.mockResolvedValueOnce({ root: "/tmp/test-vault", workspaceId: "owner-workspace", actorUserId: "editor", actorType: "human" }).mockResolvedValueOnce(new Response(null, { status: 403 }));
    mocks.write.mockImplementationOnce(async (input) => { await input.beforeCommit(); throw new Error("Unexpected commit"); });
    expect((await PUT(new Request("https://texttext.test", { method: "PUT", headers, body: "pack" }), context())).status).toBe(403);
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal), beforeCommit: expect.any(Function) }));
  });

  it("rejects a changed actor inside move/delete commit guards and maps cancellation", async () => {
    const guarded = { "X-TextText-Operation-Id": "operation-2", "If-Match": `"${"a".repeat(64)}"`, "X-TextText-Base-Path": "Note.textpack" };
    for (const [method, handler, store] of [["PATCH", PATCH, mocks.move], ["DELETE", DELETE, mocks.remove]] as const) {
      mocks.auth.mockResolvedValueOnce({ actorUserId: "initial", fullAccess: true }).mockResolvedValueOnce({ actorUserId: "changed", fullAccess: true });
      store.mockImplementationOnce(async (input) => { await input.beforeCommit(); throw new Error("Unexpected commit"); });
      const response = await handler(new Request("https://texttext.test", { method, headers: guarded, ...(method === "PATCH" ? { body: JSON.stringify({ relativePath: "Moved.textpack" }) } : {}) }), context());
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Session changed" });
    }
    mocks.write.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    expect((await PUT(new Request("https://texttext.test", { method: "PUT", headers, body: "pack" }), context())).status).toBe(204);
  });

  it("authorizes preview reads before loading any preview bytes", async () => {
    mocks.authMetadata.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const request = new Request("https://texttext.test?metadata=preview");
    expect((await GET(request, context())).status).toBe(401);
    expect(mocks.preview).not.toHaveBeenCalled();
    mocks.preview.mockResolvedValue({ title: "Note", excerpt: "Preview" });
    const response = await GET(request, context());
    expect(await response.json()).toEqual({ title: "Note", excerpt: "Preview" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("returns complete binary bytes with revision and encoded path", async () => {
    const bytes = new Uint8Array([0, 255, 3]);
    mocks.read.mockResolvedValue({ bytes, revision: "a".repeat(64), relativePath: "Notes/A note.textpack" });
    const result = await GET(new Request("https://texttext.test"), context());
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
    expect(result.headers.get("ETag")).toBe(`"${"a".repeat(64)}"`);
    expect(result.headers.get("X-TextText-Path")).toBe(headers["X-TextText-Path"]);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.authMetadata).toHaveBeenCalledTimes(2);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("rejects a moved path or revoked grant after reading bytes", async () => {
    mocks.read.mockResolvedValue({ bytes: new Uint8Array([1]), revision: "a".repeat(64), relativePath: "Notes/A note.textpack" });
    mocks.authMetadata.mockResolvedValueOnce({ relativePath: "Notes/A note.textpack" })
      .mockResolvedValueOnce({ relativePath: "Elsewhere/Moved.textpack" });
    expect((await GET(new Request("https://texttext.test"), context())).status).toBe(409);
    mocks.authMetadata.mockResolvedValueOnce({ relativePath: "Notes/A note.textpack" })
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await GET(new Request("https://texttext.test"), context())).status).toBe(404);
  });

  it("requires a base revision and propagates authenticated actor plus raw bytes", async () => {
    const missing = await PUT(new Request("https://texttext.test", { method: "PUT", headers: {
      "X-TextText-Operation-Id": "operation-1", "X-TextText-Path": headers["X-TextText-Path"],
    }, body: "pack" }), context());
    expect(missing.status).toBe(428);
    mocks.write.mockResolvedValue({ status: "written", revision: "b".repeat(64) });
    const result = await PUT(new Request("https://texttext.test", { method: "PUT", headers, body: "pack" }), context());
    expect(result.status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({
      root: "/tmp/test-vault", actorUserId: "user-1", actorType: "external_agent",
      relativePath: "Notes/A note.textpack", baseRevision: null, bytes: Buffer.from("pack"),
    }));
  });

  it("accepts native editor attribution only with a verified app token", async () => {
    const nativeHeaders = { ...headers, "X-TextText-Edit-Origin": "native-editor" };
    expect((await PUT(new Request("https://texttext.test", { method: "PUT", headers: nativeHeaders, body: "pack" }), context())).status).toBe(403);
    expect(mocks.write).not.toHaveBeenCalled();

    mocks.auth.mockResolvedValue({ root: "/tmp/test-vault", workspaceId: "owner-workspace", actorUserId: "user-1",
      actorType: "external_agent", canAttributeNativeEditor: true, fullAccess: true, relativePath: "Notes/A note.textpack" });
    mocks.write.mockResolvedValue({ status: "written", revision: "b".repeat(64) });
    const result = await PUT(new Request("https://texttext.test", { method: "PUT", headers: nativeHeaders, body: "pack" }), context());
    expect(result.status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ actorType: "human" }));
  });

  it("rechecks the app token before committing a native editor upload", async () => {
    mocks.auth.mockResolvedValueOnce({ actorUserId: "user-1", actorType: "external_agent", canAttributeNativeEditor: true })
      .mockResolvedValueOnce({ actorUserId: "user-1", actorType: "external_agent", canAttributeNativeEditor: false });
    mocks.write.mockImplementationOnce(async (input) => { await input.beforeCommit(); throw new Error("Unexpected commit"); });
    const result = await PUT(new Request("https://texttext.test", { method: "PUT",
      headers: { ...headers, "X-TextText-Edit-Origin": "native-editor" }, body: "pack",
    }), context());
    expect(result.status).toBe(403);
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ actorType: "human" }));
  });

  it("returns a preserved conflict as 409", async () => {
    mocks.write.mockResolvedValue({ status: "conflict", conflictPath: ".texttext/conflicts/operation-1.textpack" });
    const result = await PUT(new Request("https://texttext.test", { method: "PUT", headers, body: "pack" }), context());
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ status: "conflict" });
  });

  it("rejects oversized declared requests without reading or saving their body", async () => {
    const result = await PUT(new Request("https://texttext.test", { method: "PUT",
      headers: { ...headers, "Content-Length": String(64 * 1024 * 1024 + 1) }, body: "pack",
    }), context());
    expect(result.status).toBe(413);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("requires both base path and revision for move/delete and sends the authenticated actor", async () => {
    const baseHeaders = { "X-TextText-Operation-Id": "operation-2", "If-Match": `"${"a".repeat(64)}"` };
    const missing = await DELETE(new Request("https://texttext.test", { method: "DELETE", headers: baseHeaders }), context());
    expect(missing.status).toBe(428);
    const guarded = { ...baseHeaders, "X-TextText-Base-Path": encodeURIComponent("Notes/A note.textpack") };
    mocks.move.mockResolvedValue({ status: "moved" });
    expect((await PATCH(new Request("https://texttext.test", { method: "PATCH", headers: guarded, body: JSON.stringify({ relativePath: "Archive/Moved.textpack" }) }), context())).status).toBe(200);
    expect(mocks.move).toHaveBeenCalledWith(expect.objectContaining({ basePath: "Notes/A note.textpack", relativePath: "Archive/Moved.textpack", actorUserId: "user-1", baseRevision: "a".repeat(64) }));
    mocks.remove.mockResolvedValue({ status: "deleted" });
    expect((await DELETE(new Request("https://texttext.test", { method: "DELETE", headers: guarded }), context())).status).toBe(200);
  });
});
