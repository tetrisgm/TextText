import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getBlogEditAccess: vi.fn(), resolveWorkspaceAccess: vi.fn(),
  getPostById: vi.fn(), getItemAccessSummary: vi.fn(), revokeItemAccessLink: vi.fn(),
  inviteScopeShare: vi.fn(), sendShareInviteEmail: vi.fn(), getFolders: vi.fn(),
}));
vi.mock("@/auth", () => ({ isAuthConfigured: true }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/blog-edit-auth", () => ({ getBlogEditAccess: mocks.getBlogEditAccess }));
vi.mock("@/lib/permissions", async (original) => ({
  ...await original<typeof import("@/lib/permissions")>(), resolveWorkspaceAccess: mocks.resolveWorkspaceAccess,
}));
vi.mock("@/lib/store", async (original) => ({
  ...await original<typeof import("@/lib/store")>(), getPostById: mocks.getPostById,
  getItemAccessSummary: mocks.getItemAccessSummary, revokeItemAccessLink: mocks.revokeItemAccessLink,
  getFolders: mocks.getFolders,
}));
vi.mock("@/lib/shares", () => ({ inviteScopeShare: mocks.inviteScopeShare }));
vi.mock("@/lib/share-email", () => ({ sendShareInviteEmail: mocks.sendShareInviteEmail }));
import { getItemAccessSummaryAction, revokeItemAccessLinkAction, shareScopeAction } from "@/app/editor/actions";
const itemId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ sub: "owner", userId: "owner-id", name: "Owner" });
  mocks.getBlogEditAccess.mockResolvedValue({ isOwner: true, blogId: "workspace" });
  mocks.resolveWorkspaceAccess.mockResolvedValue({ canManage: true });
  mocks.getPostById.mockResolvedValue({ id: itemId, title: "Story", slug: "story" });
  mocks.getItemAccessSummary.mockResolvedValue({ itemId, visibility: "public" });
  mocks.inviteScopeShare.mockResolvedValue({ email: "guest@example.com" });
});

describe("sharing management actions", () => {
  it("returns the server summary for the authorized item", async () => {
    await expect(getItemAccessSummaryAction("demo", itemId)).resolves.toEqual({ itemId, visibility: "public" });
    expect(mocks.getItemAccessSummary).toHaveBeenCalledWith("demo", itemId);
  });
  it.each(["signed-out", "viewer", "foreign-or-deleted-item"])("rejects %s before listing or revoking links", async (scenario) => {
    if (scenario === "signed-out") mocks.getCurrentUser.mockResolvedValue(null);
    if (scenario === "viewer") {
      mocks.getBlogEditAccess.mockResolvedValue({ isOwner: false });
      mocks.resolveWorkspaceAccess.mockResolvedValue({ canManage: false });
    }
    if (scenario === "foreign-or-deleted-item") mocks.getPostById.mockResolvedValue(null);
    await expect(getItemAccessSummaryAction("demo", itemId)).rejects.toThrow();
    await expect(revokeItemAccessLinkAction("demo", itemId, itemId)).rejects.toThrow();
    expect(mocks.getItemAccessSummary).not.toHaveBeenCalled();
    expect(mocks.revokeItemAccessLink).not.toHaveBeenCalled();
  });
  it("passes the authenticated actor and item scope to audited revocation", async () => {
    await revokeItemAccessLinkAction("demo", itemId, "link-id");
    expect(mocks.revokeItemAccessLink).toHaveBeenCalledWith("demo", itemId, "link-id", {
      actorType: "human", actorUserId: "owner-id",
    });
  });
  it.each(["sent", "not_sent", "failed"])("keeps access granted separate from email %s", async (emailStatus) => {
    if (emailStatus === "failed") mocks.sendShareInviteEmail.mockRejectedValue(new Error("SMTP unavailable"));
    else mocks.sendShareInviteEmail.mockResolvedValue(emailStatus);
    const receipt = await shareScopeAction("demo", "item", itemId, "guest@example.com", "commenter");
    expect(receipt).toEqual({ accessGranted: true, emailStatus });
    expect(mocks.inviteScopeShare).toHaveBeenCalledWith(expect.objectContaining({ role: "commenter", invitedBySub: "owner" }));
    expect(mocks.sendShareInviteEmail).toHaveBeenCalledWith(expect.objectContaining({ role: "commenter" }));
  });
  it("does not attempt email or report a grant if the audited mutation fails", async () => {
    mocks.inviteScopeShare.mockRejectedValue(new Error("audit transaction failed"));
    await expect(shareScopeAction("demo", "item", itemId, "guest@example.com", "viewer")).rejects.toThrow("audit transaction failed");
    expect(mocks.sendShareInviteEmail).not.toHaveBeenCalled();
  });
  it("reports no email for workspace invitations", async () => {
    await expect(shareScopeAction("demo", "workspace", "workspace", "guest@example.com", "guest"))
      .resolves.toEqual({ accessGranted: true, emailStatus: "not_sent" });
    expect(mocks.sendShareInviteEmail).not.toHaveBeenCalled();
  });
});
