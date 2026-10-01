import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/app/api/vault/scoped-auth", () => ({ authorizeVaultWorkspaceOrScoped: mocks.authorize }));
import { GET } from "./route";

const workspaceId = "56129da8-7467-4876-b238-46d748c2c57b";
const request = new Request(`https://texttext.test/api/vault/${workspaceId}/access`);
const context = { params: Promise.resolve({ workspaceId }) };

describe("file-vault UI capabilities", () => {
  beforeEach(() => vi.resetAllMocks());

  it("exposes only scoped role and scope, without server paths or actor details", async () => {
    mocks.authorize.mockResolvedValue({ root: "/private/vault", workspaceId, actorUserId: "recipient-id",
      actorName: "Recipient", actorType: "human", fullAccess: false, isOwner: false,
      canEditContent: false, canComment: false, canManageShares: false,
      grants: [{ id: "grant-id", email: "recipient@example.test", role: "editor", folderSignature: "secret-signature",
        scope: { type: "folder", key: "Projects" } }],
    });
    const response = await GET(request, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ fullAccess: false, isOwner: false,
      canEditContent: false, canComment: false, canManageShares: false,
      grants: [{ scopeType: "folder", scopeKey: "Projects", role: "editor" }] });
    expect(mocks.authorize).toHaveBeenCalledWith(request, workspaceId);
  });

  it("preserves authorization denial without returning capability data", async () => {
    mocks.authorize.mockResolvedValue(Response.json({ error: "Workspace not found" }, { status: 404 }));
    const response = await GET(request, context);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Workspace not found" });
  });
});
