import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { execute: mocks.execute } }));
import { getItemAccessSummary, revokeItemAccessLink } from "@/lib/store";

const itemId = "11111111-1111-4111-8111-111111111111";
const linkId = "22222222-2222-4222-8222-222222222222";
const owner = { id: "owner", name: "Owner", email: "owner@example.com", role: "owner" };
const grant = { id: "direct", email: "reader@example.com", role: "commenter", accepted: true,
  createdAt: "2026-09-05T00:00:00Z", scopeType: "item", scopeId: itemId, scopeName: null };
const link = { id: linkId, label: "Review", role: "editor", expiresAt: null };
function row(overrides = {}) {
  return { id: itemId, slug: "story", username: "writer", folder_path: "blog", visibility: "private",
    owner, grants: [], links: [], ...overrides };
}
beforeEach(() => { vi.clearAllMocks(); });

describe("item access summary", () => {
  it.each([
    ["private", [], "private"], ["public", [], "public"], ["link", [], "link"],
    ["private", [link], "link"], ["public", [link], "public"],
  ])("reports %s with links %j as %s", async (visibility, links, effective) => {
    mocks.execute.mockResolvedValue({ rows: [row({ visibility, links })] });
    const summary = await getItemAccessSummary("demo", itemId);
    expect(summary.visibility).toBe(effective);
    expect(summary.pageVisibility).toBe(visibility);
    expect(summary.pagePath).toBe("/@writer/blog/story");
    expect(summary.owner).toEqual(owner);
    expect(summary.links).toEqual(links);
  });

  it("keeps direct and overlapping inherited grants, using the permission resolver's role mapping", async () => {
    mocks.execute.mockResolvedValue({ rows: [row({ grants: [grant,
      { ...grant, id: "folder", scopeType: "folder", role: "reviewer", scopeName: "Reviews" },
      { ...grant, id: "workspace", scopeType: "workspace", role: "member", scopeName: "Team" },
      { ...grant, id: "guest", scopeType: "workspace", role: "guest", scopeName: "Team" },
      { ...grant, id: "invalid", role: "invented" },
    ] })] });
    const summary = await getItemAccessSummary("demo", itemId);
    expect(summary.direct).toEqual([expect.objectContaining({ id: "direct", role: "commenter" })]);
    expect(summary.inherited.map(({ id, role, scopeName }) => ({ id, role, scopeName }))).toEqual([
      { id: "folder", role: "commenter", scopeName: "Reviews" },
      { id: "workspace", role: "editor", scopeName: "Team" },
      { id: "guest", role: "viewer", scopeName: "Team" },
    ]);
  });

  it("reads a single live, tenant-scoped snapshot with bounded ancestry and active links only", async () => {
    mocks.execute.mockResolvedValue({ rows: [row()] });
    await getItemAccessSummary("demo", itemId);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    const text = query.sql.replace(/\s+/g, " ");
    expect(query.params).toEqual([itemId, "demo"]);
    for (const predicate of ["p.deleted_at IS NULL", "b.deleted_at IS NULL", "f.deleted_at IS NULL",
      "f.blog_id = i.blog_id", "NOT f.id = ANY(a.visited)", "i.folder_id IS NULL AND f.path = 'blog'",
      "c.revoked_at IS NULL", "l.revoked_at IS NULL", "l.expires_at > now()", "l.post_id = i.id"]) {
      expect(text).toContain(predicate);
    }
    expect(text).not.toMatch(/token|hash|password/);
  });

  it("throws for missing, malformed or unavailable access instead of promising privacy", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    await expect(getItemAccessSummary("demo", itemId)).rejects.toThrow("Item not found");
    mocks.execute.mockResolvedValueOnce({ rows: [row({ visibility: "unknown" })] });
    await expect(getItemAccessSummary("demo", itemId)).rejects.toThrow("unavailable");
    mocks.execute.mockRejectedValueOnce(new Error("offline"));
    await expect(getItemAccessSummary("demo", itemId)).rejects.toThrow("offline");
  });

  it("revokes only the requested item's link and writes its audit in the same statement", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await revokeItemAccessLink("demo", itemId, linkId, { actorType: "human", actorUserId: null });
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.sql).toContain('INSERT INTO "action_audit"');
    expect(query.sql).toContain('FROM "changed"');
    expect(query.sql).toContain("l.post_id =");
    expect(query.sql).toContain("b.handle =");
    expect(query.params).toEqual(expect.arrayContaining([linkId, itemId, "demo", "share.link.revoke", "human"]));
  });
});
