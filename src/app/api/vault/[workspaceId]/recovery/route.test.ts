import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), list: vi.fn(), read: vi.fn() }));
vi.mock("@/app/api/vault/auth", () => ({ authorizeVault: mocks.authorize }));
vi.mock("@/lib/store", () => ({ listVaultRecovery: mocks.list, readVaultRecovery: mocks.read }));
import { GET } from "./route";

describe("file vault recovery route", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it("exposes deleted tombstone entries from the authorized store unchanged", async () => {
    mocks.authorize.mockResolvedValue({ root: "/trusted", workspaceId: "workspace" });
    const entry = { id: "opaque-history-token", kind: "deleted", path: "Notes/Recovered.textpack", hash: "a".repeat(64), savedAt: "2026-09-30T00:00:00.000Z" };
    mocks.list.mockResolvedValue({ entries: [entry], truncated: false });
    const response = await GET(new Request("http://localhost/api/vault/workspace/recovery"), { params: Promise.resolve({ workspaceId: "workspace" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entries: [entry], truncated: false });
    expect(mocks.list).toHaveBeenCalledWith({ root: "/trusted", workspaceId: "workspace" });
  });
  it("does not inspect retained files before authorization", async () => {
    mocks.authorize.mockResolvedValue(new Response(null, { status: 401 }));
    const response = await GET(new Request("http://localhost/api/vault/workspace/recovery?id=token"), { params: Promise.resolve({ workspaceId: "workspace" }) });
    expect(response.status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
