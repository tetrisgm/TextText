import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ resolve: vi.fn(), execute: vi.fn(), stage: vi.fn(), blog: vi.fn() }));
vi.mock("@/lib/api-tokens", () => ({ resolveApiToken: m.resolve }));
vi.mock("@/lib/store", () => ({ getOwnedBlog: m.blog }));
vi.mock("@/lib/ai/write-proposals.server", () => ({ createWorkspaceWriteProposal: m.stage }));
vi.mock("@/lib/mcp/tools", () => ({
  resolveMcpScopeAccess: (scopes: string[]) => scopes.includes("read") ? "read-only" : scopes.includes("sync") ? "full" : "none",
  runWorkspaceToolForAuth: m.execute,
}));
import { POST } from "@/app/api/agent/commands/route";
let current: { id: string; userId: string; sub: string; scopes: string; name: string; expiresAt: Date | null } | null;
beforeEach(() => {
  vi.clearAllMocks();
  current = { id: "connection", userId: "owner", sub: "owner-sub", scopes: "sync", name: "Original", expiresAt: null };
  // Mirrors token storage's expiry filter, while using the real auth adapter.
  m.resolve.mockImplementation(async () => current?.expiresAt && current.expiresAt.getTime() <= Date.now() ? null : current);
  m.execute.mockResolvedValue({ content: [] });
  m.blog.mockResolvedValue({ handle: "workspace" });
  m.stage.mockResolvedValue({ id: "proposal" });
});
afterEach(() => vi.useRealTimers());
async function upload(name: string) {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const request = new Request("https://texttext.app/api/agent/commands", {
    method: "POST", headers: { "content-type": "application/json" },
    body: new ReadableStream<Uint8Array>({ start(controller) { body = controller; } }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const response = POST(request);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(m.resolve).toHaveBeenCalledOnce();
  expect(m.execute).not.toHaveBeenCalled(); expect(m.stage).not.toHaveBeenCalled();
  return {
    finish() {
      body.enqueue(new TextEncoder().encode(JSON.stringify({ name, arguments: { id: "item", title: "Changed" } })));
      body.close(); return response;
    },
  };
}

it.each(["read_item", "proposal:update_item"])("refuses %s if its token expires while the body is open", async (name) => {
  vi.useFakeTimers();
  current!.expiresAt = new Date(Date.now() + 1000);
  const pending = await upload(name);
  vi.setSystemTime(Date.now() + 2000);
  expect((await pending.finish()).status).toBe(401);
  expect(m.resolve).toHaveBeenCalledTimes(2);
  expect(m.execute).not.toHaveBeenCalled(); expect(m.stage).not.toHaveBeenCalled();
});

it("refuses proposal staging after mid-upload revocation", async () => {
  const pending = await upload("proposal:update_item"); current = null;
  expect((await pending.finish()).status).toBe(401);
  expect(m.stage).not.toHaveBeenCalled(); expect(m.blog).not.toHaveBeenCalled();
});

it.each(["update_item", "proposal:update_item"])("applies reduced scopes to %s after upload", async (name) => {
  const pending = await upload(name); current = { ...current!, scopes: "read" };
  expect((await pending.finish()).status).toBe(403);
  expect(m.execute).not.toHaveBeenCalled(); expect(m.stage).not.toHaveBeenCalled();
});

it("dispatches allowed reads with the refreshed scopes and actor metadata", async () => {
  const pending = await upload("read_item");
  current = { ...current!, scopes: "read", name: "Renamed connection" };
  expect((await pending.finish()).status).toBe(200);
  expect(m.execute).toHaveBeenCalledWith("read_item", expect.anything(), {
    authInfo: expect.objectContaining({ scopes: ["read"], extra: expect.objectContaining({
      connectionName: "Renamed connection", connectionId: "connection", actorType: "external_agent",
    }) }),
  });
});

it("constructs proposal actors from the refreshed identity", async () => {
  const pending = await upload("proposal:update_item");
  current = { ...current!, userId: "current-owner", sub: "current-sub", id: "current-connection" };
  expect((await pending.finish()).status).toBe(202);
  expect(m.blog).toHaveBeenCalledExactlyOnceWith("current-sub");
  expect(m.stage).toHaveBeenCalledWith(expect.objectContaining({ actor: {
    userId: "current-owner", sub: "current-sub", connectionId: "current-connection", handle: "workspace", actorType: "external_agent",
  } }));
});

it("rejects an invalid token without waiting for an open body", async () => {
  current = null;
  const request = new Request("https://texttext.app/api/agent/commands", {
    method: "POST", body: new ReadableStream(), duplex: "half",
  } as RequestInit & { duplex: "half" });
  expect((await POST(request)).status).toBe(401);
  expect(request.bodyUsed).toBe(false);
  expect(m.resolve).toHaveBeenCalledOnce();
});
