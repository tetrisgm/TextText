import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ user: vi.fn(), blog: vi.fn(), userId: vi.fn(), read: vi.fn(), decide: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/store", () => ({ getOwnedBlog: mocks.blog, getUserIdBySub: mocks.userId }));
vi.mock("@/lib/ai/write-proposals.server", () => ({ getWorkspaceWriteProposalForReview: mocks.read, decideWorkspaceWriteProposal: mocks.decide }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("not-found"); },
}));
import Page from "../page";
const id = "11111111-1111-4111-8111-111111111111";
const params = Promise.resolve({ id });
function forms(node: ReactNode): Array<() => Promise<void>> {
  if (Array.isArray(node)) return node.flatMap(forms);
  if (!isValidElement<{ action?: () => Promise<void>; children?: ReactNode }>(node)) return [];
  return node.type === "form" ? [node.props.action!] : forms(node.props.children);
}
describe("owner proposal review page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ sub: "apple-sub", userId: "user-1" });
    mocks.blog.mockResolvedValue({ handle: "alpha" });
    mocks.read.mockResolvedValue({ id, title: "Update item", summary: "Review replacement", status: "pending", arguments: { body: "<script>unsafe()</script>" }, origin: { surface: "hosted_mcp", connectionName: "Research agent" } });
    mocks.decide.mockResolvedValue({ status: "completed" });
  });
  it("reads only owner-bound data and renders exact arguments as escaped text", async () => {
    const tree = await Page({ params });
    const html = renderToStaticMarkup(tree);
    expect(mocks.read).toHaveBeenCalledWith({ sub: "apple-sub", userId: "user-1", handle: "alpha" }, id);
    expect(html).toContain("Research agent"); expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>unsafe()"); expect(forms(tree)).toHaveLength(2);
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it("requires sign-in before revealing any review data", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(Page({ params })).rejects.toThrow("redirect:/api/auth/signin?callbackUrl=");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("hides absent or foreign-owner proposals", async () => {
    mocks.read.mockResolvedValue(null);
    await expect(Page({ params })).rejects.toThrow("not-found");
  });
  it.each(["completed", "denied", "expired", "failed", "executing"])("offers no mutation controls for %s", async (status) => {
    mocks.read.mockResolvedValue({ id, title: "Update item", arguments: {}, status });
    expect(forms(await Page({ params }))).toHaveLength(0);
  });
  it.each([0, 1])("rechecks the session and decides only the stored id from form %i", async (index) => {
    const actions = forms(await Page({ params }));
    mocks.user.mockResolvedValue({ sub: "new-sub", userId: "user-2" });
    mocks.blog.mockResolvedValue({ handle: "beta" });
    await expect(actions[index]()).rejects.toThrow(`redirect:/proposals/${id}`);
    expect(mocks.decide).toHaveBeenCalledWith({ actor: { sub: "new-sub", userId: "user-2", handle: "beta" }, proposalId: id, decision: index === 0 ? "approve" : "deny" });
  });
  it("does not approve if the owner signed out after loading", async () => {
    const [approve] = forms(await Page({ params }));
    mocks.user.mockResolvedValue(null);
    await expect(approve()).rejects.toThrow("redirect:/api/auth/signin");
    expect(mocks.decide).not.toHaveBeenCalled();
  });
});
