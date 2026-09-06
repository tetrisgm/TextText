import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), access: vi.fn(), user: vi.fn(), capability: vi.fn(), cookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/permissions", async (original) => ({ ...(await original<typeof import("@/lib/permissions")>()), resolveItemAccess: mocks.access }));
vi.mock("@/lib/store", () => ({ getPostStoreContext: mocks.context, resolveDocumentCapability: mocks.capability }));
import { GET } from "@/app/api/items/[id]/reader-revision/route";
const id = "11111111-1111-4111-8111-111111111111";
const request = () => GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ handle: "writer", post: { revision: 42, updatedAt: "today", status: "published", visibility: "private" } });
  mocks.access.mockResolvedValue({ canView: false });
  mocks.user.mockResolvedValue(null);
});
it("F7: a public item made private during authorization no longer discloses its revision", async () => {
  let live = { status: "published", visibility: "public", revision: 42, updatedAt: "today" };
  mocks.context.mockImplementation(async () => ({ handle: "writer", post: { ...live } }));
  mocks.access.mockImplementation(async () => {
    // The owner commits a visibility change after the initial row read.
    live = { ...live, visibility: "private", revision: 43 };
    return { canView: false };
  });
  const response = await request();
  expect.soft(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Item not found" });
});
