import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ select: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { select: mocks.select }, executeAtomicBatch: vi.fn() }));
vi.mock("@/lib/store", () => ({ getUserIdBySub: vi.fn(async () => "user") }));
vi.mock("@/lib/permissions", async (original) => ({ ...(await original<typeof import("@/lib/permissions")>()), resolveItemAccess: mocks.access }));
import { getSharedPostsForUser } from "@/lib/shares";
import { collabAccess } from "@/lib/collab";
import { parseWorkspaceToolInput } from "@/lib/ai/tools";
const user = { sub: "test", userId: "user", email: "reader@example.com" };
function query(rows: unknown[]) {
  type Query = PromiseLike<unknown[]> & Record<"from" | "where" | "innerJoin" | "leftJoin" | "limit", () => Query>;
  const promise = Promise.resolve(rows);
  const q: Query = { then: promise.then.bind(promise), from: () => q, where: () => q,
    innerJoin: () => q, leftJoin: () => q, limit: () => q };
  return q;
}
const post = (id: string) => ({ id, title: id, slug: id, blogHandle: "writer", blogName: "Team", blogUsername: "writer", updatedAt: new Date("2026-09-05T00:00:00Z"), deletedAt: null });
beforeEach(() => { vi.resetAllMocks(); });
it("round7: command accepts the commenter role offered by sharing UI", () => {
  expect(() => parseWorkspaceToolInput("set_access", { scope_type: "item", scope_id: "item", email: user.email, role: "commenter" })).not.toThrow();
});
it("round7: a viewer capability cannot downgrade a named editor", async () => {
  mocks.select.mockReturnValue(query([{ handle: "writer" }]));
  mocks.access.mockResolvedValue({ canEditContent: true, canView: true });
  expect(await collabAccess(user, "11111111-1111-4111-8111-111111111111", "viewer")).toBe("editor");
});
it("round7: discovery preserves commenter role", async () => {
  mocks.select.mockReturnValueOnce(query([{ scopeType: "item", scopeId: "review", role: "commenter" }]))
    .mockReturnValueOnce(query([post("review")]));
  expect(await getSharedPostsForUser(user)).toEqual([expect.objectContaining({ role: "commenter" })]);
});
it("round7: workspace invitations are discoverable", async () => {
  mocks.select.mockReturnValueOnce(query([{ scopeType: "workspace", scopeId: "team", role: "member" }]))
    .mockReturnValue(query([post("team")]));
  expect(await getSharedPostsForUser(user)).toEqual([expect.objectContaining({
    scopeType: "workspace", postId: "team", role: "member", blogHandle: "writer",
  })]);
});
it("round7: editor rights on one folder do not relabel another folder", async () => {
  mocks.select.mockReturnValueOnce(query([
    { scopeType: "folder", scopeId: "edit", role: "editor" }, { scopeType: "folder", scopeId: "view", role: "viewer" },
  ])).mockReturnValueOnce(query([{ id: "edit", blogId: "team", parentId: null }, { id: "view", blogId: "team", parentId: null }]))
    .mockReturnValueOnce(query([{ id: "edit", parentId: null }, { id: "view", parentId: null }]))
    .mockReturnValueOnce(query([{ id: "edit-page", folderId: "edit" }, { id: "view-page", folderId: "view" }]))
    .mockReturnValueOnce(query([post("edit-page"), post("view-page")]));
  expect((await getSharedPostsForUser(user)).find(p => p.postId === "view-page")?.role).toBe("viewer");
});

it("round7: small white caret labels meet contrast on both themes", async () => {
  const { colorForSub } = await import("@/lib/collab");
  const { peerLabelInk } = await import("@/lib/collab/peer-color");
  const ratio = (hex: string) => {
    const channels = hex.slice(1).match(/../g)!.map(c => parseInt(c, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    return peerLabelInk(hex) === "#fff" ? 1.05 / (luminance + .05) : (luminance + .05) / .05;
  };
  // Both editor caret surfaces use contrast-selected ink on opaque peer fills.
  const colors = Array.from({ length: 100 }, (_, i) => colorForSub(String(i)));
  expect(Math.min(...colors.map(ratio))).toBeGreaterThanOrEqual(4.5);
});

it("round7: comment submit buttons meet contrast in light and dark mode", async () => {
  // Filled comment controls use --ac-accent-fill with --ac-accent-fill-ink; the
  // brand accent itself stays for links and selection. Every theme's pair must
  // reach 4.5:1 for the small button text.
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../../styles/apple.css", import.meta.url), "utf8");
  const pairs = [...css.matchAll(/--ac-accent-fill:\s*(#[0-9a-fA-F]{6});\s*--ac-accent-fill-ink:\s*(#[0-9a-fA-F]{6})/g)].map(match => [match[1], match[2]]);
  expect(pairs.length).toBeGreaterThanOrEqual(2);
  const luminance = (hex: string) => { const c = hex.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  for (const [fill, ink] of pairs) {
    const [hi, lo] = [luminance(fill), luminance(ink)].sort((a, b) => b - a);
    expect.soft((hi + 0.05) / (lo + 0.05), `${ink} comment-button text on ${fill}`).toBeGreaterThanOrEqual(4.5);
  }
  const buttons = readFileSync(new URL("../../components/workspace/ReaderComments.module.css", import.meta.url), "utf8");
  expect(buttons).toContain("background: var(--ac-accent-fill);");
  expect(buttons).toContain("color: var(--ac-accent-fill-ink);");
  expect(buttons).not.toContain("background: var(--ac-accent);");
});

it.each(["item", "folder"])("accepts commenter at %s scope", (scope_type) => {
  expect(() => parseWorkspaceToolInput("set_access", { scope_type, scope_id: "target", email: user.email, role: "commenter" })).not.toThrow();
});
it.each(["editor", "commenter", "viewer"])("rejects %s as a workspace role", (role) => {
  expect(() => parseWorkspaceToolInput("set_access", { scope_type: "workspace", email: user.email, role })).toThrow();
});
it.each(["member", "guest"])("rejects %s as an item role", (role) => {
  expect(() => parseWorkspaceToolInput("set_access", { scope_type: "item", scope_id: "target", email: user.email, role })).toThrow();
});
it("workspace guest is a destination, without expanding every workspace item", async () => {
  mocks.select.mockReturnValueOnce(query([{ scopeType: "workspace", scopeId: "team", role: "guest" }]))
    .mockReturnValueOnce(query([post("team")]));
  expect(await getSharedPostsForUser(user)).toEqual([expect.objectContaining({ scopeType: "workspace", postId: "team", role: "guest" })]);
  expect(mocks.select).toHaveBeenCalledTimes(2);
});
it("strongest direct and ancestor grants win while unrelated folders stay unchanged", async () => {
  mocks.select.mockReturnValueOnce(query([
    { scopeType: "folder", scopeId: "parent", role: "commenter" },
    { scopeType: "folder", scopeId: "child", role: "viewer" },
    { scopeType: "item", scopeId: "direct", role: "editor" },
    { scopeType: "item", scopeId: "direct", role: "viewer" },
  ])).mockReturnValueOnce(query([{ id: "parent", blogId: "team" }, { id: "child", blogId: "team" }]))
    .mockReturnValueOnce(query([{ id: "parent", parentId: null, path: "blog" }, { id: "child", parentId: "parent" }, { id: "grandchild", parentId: "child" }]))
    .mockReturnValueOnce(query([{ id: "direct", folderId: "child" }, { id: "nested", folderId: "grandchild" }, { id: "legacy", folderId: null }]))
    .mockReturnValueOnce(query([post("direct"), post("nested"), post("legacy")]));
  const entries = await getSharedPostsForUser(user);
  expect(entries.find((p) => p.postId === "direct")?.role).toBe("editor");
  expect(entries.find((p) => p.postId === "nested")?.role).toBe("commenter");
  expect(entries.find((p) => p.postId === "legacy")?.role).toBe("commenter");
});
it("workspace membership upgrades a directly discovered item", async () => {
  mocks.select.mockReturnValueOnce(query([{ scopeType: "workspace", scopeId: "team", role: "member" }, { scopeType: "item", scopeId: "review", role: "viewer" }]))
    .mockReturnValueOnce(query([{ ...post("review"), blogId: "team" }]))
    .mockReturnValueOnce(query([post("team")]));
  expect((await getSharedPostsForUser(user)).find((p) => p.postId === "review")?.role).toBe("editor");
});
it("unknown roles do not make discovery entries", async () => {
  mocks.select.mockReturnValueOnce(query([{ scopeType: "workspace", scopeId: "team", role: "unknown" }, { scopeType: "item", scopeId: "secret", role: "unknown" }]));
  expect(await getSharedPostsForUser(user)).toEqual([]);
});
it.each(["viewer", "commenter", "editor"] as const)("capability %s may add access to a named viewer", async (capability) => {
  mocks.select.mockReturnValue(query([{ handle: "writer" }]));
  mocks.access.mockResolvedValue({ canEditContent: false, canView: true });
  expect(await collabAccess(user, "11111111-1111-4111-8111-111111111111", capability)).toBe(capability === "editor" ? "editor" : "viewer");
});

it.each([
  ["editor", "editor", "member"],
  ["commenter", "commenter", "guest"],
  ["reviewer", "commenter", "guest"],
  ["viewer", "viewer", "guest"],
])("legacy workspace %s preserves effective item rights and current destination labels", async (role, itemRole, workspaceRole) => {
  mocks.select.mockReturnValueOnce(query([
    { scopeType: "workspace", scopeId: "team", role },
    { scopeType: "item", scopeId: "review", role: "viewer" },
  ])).mockReturnValueOnce(query([{ ...post("review"), blogId: "team" }]))
    .mockReturnValueOnce(query([post("team")]));
  const entries = await getSharedPostsForUser(user);
  expect(entries.find(p => p.postId === "review")?.role).toBe(itemRole);
  expect(entries.find(p => p.postId === "team")?.role).toBe(workspaceRole);
});
