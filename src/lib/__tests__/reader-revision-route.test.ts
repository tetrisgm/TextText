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
it("returns only the current revision to a named viewer, without caching", async () => {
  mocks.access.mockResolvedValue({ canView: true });
  const response = await request();
  expect(await response.json()).toEqual({ revision: "42:today" });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it.each(["viewer", "commenter", "editor"])("accepts a valid %s capability for this item", async (role) => {
  mocks.cookie.mockReturnValue({ value: "test-token" });
  mocks.capability.mockResolvedValue({ itemId: id, role });
  expect((await request()).status).toBe(200);
});
it.each([null, { itemId: "another-item", role: "editor" }])("rejects invalid, expired, revoked or wrong-item capabilities: %j", async (capability) => {
  mocks.cookie.mockReturnValue({ value: "test-token" });
  mocks.capability.mockResolvedValue(capability);
  expect((await request()).status).toBe(404);
});
it.each(["public", "link"])("allows a published %s item but rejects it after visibility becomes private", async (visibility) => {
  mocks.context.mockResolvedValue({ handle: "writer", post: { status: "published", visibility, revision: 42 } });
  expect((await request()).status).toBe(200);
  // Change live state between requests, not between the initial lookup and
  // the new disclosure check within the first request.
  mocks.context.mockResolvedValue({ handle: "writer", post: { status: "published", visibility: "private", revision: 43 } });
  expect((await request()).status).toBe(404);
});
it.each([{ status: "draft", visibility: "public" }, { status: "published" }])("fails closed for draft or unspecified visibility: %j", async (post) => {
  mocks.context.mockResolvedValue({ handle: "writer", post });
  expect((await request()).status).toBe(404);
});
it("rejects missing or trashed items even with named access", async () => {
  mocks.access.mockResolvedValue({ canView: true });
  mocks.context.mockResolvedValue(null);
  expect((await request()).status).toBe(404);
});

it("returns the revision from the final live read", async () => {
  mocks.access.mockResolvedValue({ canView: true });
  mocks.context.mockResolvedValueOnce({ handle: "writer", post: { revision: 42 } })
    .mockResolvedValue({ handle: "writer", post: { revision: 43, updatedAt: "now" } });
  expect(await (await request()).json()).toEqual({ revision: "43:now" });
});

it("withholds a revision when Trash is observed at disclosure even with a capability", async () => {
  mocks.cookie.mockReturnValue({ value: "test-token" });
  mocks.capability.mockResolvedValue({ itemId: id, role: "viewer" });
  mocks.context.mockResolvedValueOnce({ handle: "writer", post: { revision: 42 } }).mockResolvedValue(null);
  const response = await request();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Item not found" });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
