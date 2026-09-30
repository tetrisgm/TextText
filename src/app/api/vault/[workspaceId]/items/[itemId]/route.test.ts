import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), write: vi.fn(), move: vi.fn(), remove: vi.fn() }));
vi.mock("@/app/api/vault/auth", () => ({ authorizeVault: mocks.auth }));
vi.mock("@/lib/store", () => ({
  readVaultTextpack: mocks.read,
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

describe("owner vault API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", "/tmp/test-vault");
    mocks.auth.mockResolvedValue({ root: "/tmp/test-vault", workspaceId: "owner-workspace", actorUserId: "user-1", actorType: "external_agent" });
  });

  it("rejects unauthenticated reads and cross-workspace writes before file access", async () => {
    mocks.auth.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect((await GET(new Request("https://texttext.test"), context())).status).toBe(401);
    mocks.auth.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await PUT(new Request("https://texttext.test", { method: "PUT", headers, body: "pack" }), {
      params: Promise.resolve({ workspaceId: "someone-else", itemId: "item-1" }),
    })).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("returns complete binary bytes with revision and encoded path", async () => {
    const bytes = new Uint8Array([0, 255, 3]);
    mocks.read.mockResolvedValue({ bytes, revision: "a".repeat(64), relativePath: "Notes/A note.textpack" });
    const result = await GET(new Request("https://texttext.test"), context());
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
    expect(result.headers.get("ETag")).toBe(`"${"a".repeat(64)}"`);
    expect(result.headers.get("X-TextText-Path")).toBe(headers["X-TextText-Path"]);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
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
