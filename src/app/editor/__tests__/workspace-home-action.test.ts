import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), owned: vi.fn(), access: vi.fn() }));
vi.mock("@/auth", () => ({ isAuthConfigured: true }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/workspace", () => ({ resolveOwnedWorkspace: mocks.owned }));
vi.mock("@/lib/permissions", async original => ({ ...await original<typeof import("@/lib/permissions")>(), resolveWorkspaceAccess: mocks.access }));
import { resolveWorkspaceHomePath } from "../actions";
describe("canonical signed-in workspace home", () => {
 beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({sub:"provider-sub",userId:"user-1"}); mocks.owned.mockResolvedValue({handle:"writer"}); mocks.access.mockResolvedValue({isOwner:true,blogId:"workspace-1",userId:"user-1"}); });
 it("uses authoritative owner workspace identity, with fresh permissions", async () => {
  expect(await resolveWorkspaceHomePath()).toBe("/vault/workspace-1");
  expect(mocks.access).toHaveBeenCalledWith({handle:"writer",user:{sub:"provider-sub",userId:"user-1"},fresh:true});
 });
 it("refuses signed-out or nonowner routes rather than exposing a workspace", async () => {
  mocks.user.mockResolvedValueOnce(null); await expect(resolveWorkspaceHomePath()).rejects.toThrow("Not signed in");
  for(const access of [{isOwner:false,blogId:"other",userId:"user-1"},{isOwner:true,blogId:null,userId:"user-1"},{isOwner:true,blogId:"workspace-1",userId:null}]) {
   mocks.access.mockResolvedValueOnce(access);await expect(resolveWorkspaceHomePath()).rejects.toThrow("Workspace not found");
  }
 });
});
