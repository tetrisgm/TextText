import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), stage: vi.fn() }));
vi.mock("@/app/api/vault/scoped-auth", () => ({ authorizeVaultWorkspaceOrScoped: mocks.authorize }));
vi.mock("@/lib/ai/write-proposals.server", () => ({ createWorkspaceWriteProposal: mocks.stage }));
import { POST } from "./route";
const context = { params: Promise.resolve({ workspaceId: "workspace" }) };
const body = { source: "Notes", destination: "Archive/Notes" };
const request = (value: unknown) => new Request("https://texttext.test/api/vault/workspace/folder-moves", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://texttext.test" }, body: JSON.stringify(value),
});
describe("owner folder move staging", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorize.mockResolvedValue({ actorSub: "subject", actorUserId: "owner", workspaceHandle: "owner", canManageShares: true });
    mocks.stage.mockResolvedValue({ id: "review-id", tool: "move_folder_tree" });
  });
  it("stages the canonical human action and returns an owner review, without executing", async () => {
    const response = await POST(request(body), context);
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ reviewPath: "/proposals/review-id" });
    expect(mocks.stage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      actor: expect.objectContaining({ sub: "subject", userId: "owner", handle: "owner", actorType: "human" }),
      tool: "move_folder_tree", arguments: expect.objectContaining({ source_path: "Notes", destination_path: "Archive/Notes" }),
    }));
  });
  it("rejects generic tokens and non-owners before staging", async () => {
    mocks.authorize.mockResolvedValue({ canManageShares: false });
    expect((await POST(request(body), context)).status).toBe(403);
    expect(mocks.stage).not.toHaveBeenCalled();
  });
  it("preserves failed authentication without inspecting command arguments", async () => {
    mocks.authorize.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await POST(request(body), context)).status).toBe(401);
    expect(mocks.stage).not.toHaveBeenCalled();
  });
  it.each([{ ...body, review: {} }, { ...body, destination: "../escape" }, { ...body, source: "" }])("rejects invalid or caller-approved paths", async value => {
    expect((await POST(request(value), context)).status).toBe(400);
    expect(mocks.stage).not.toHaveBeenCalled();
  });
  it("bounds the body and reports authoritative staging conflicts", async () => {
    expect((await POST(request({ ...body, extra: "x".repeat(3000) }), context)).status).toBe(413);
    mocks.stage.mockRejectedValue(new Error("Internal database details"));
    const response = await POST(request(body), context);
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("Internal database");
  });
});
