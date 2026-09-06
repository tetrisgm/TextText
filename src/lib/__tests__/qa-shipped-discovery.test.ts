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
it.each(["editor", "commenter", "reviewer", "viewer"])("F4: discovers still-authorized legacy workspace role %s", async role => {
  const { roleForTarget } = await import("@/lib/permissions");
  expect(roleForTarget(role, "workspace", "item")).not.toBeNull();
  mocks.select.mockReturnValueOnce(query([{ scopeType: "workspace", scopeId: "team", role }]))
    .mockReturnValueOnce(query([post("team")]));
  expect(await getSharedPostsForUser(user)).toEqual([expect.objectContaining({ scopeType: "workspace", postId: "team" })]);
});
