import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ revoked: false, resolve: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/api-tokens", () => ({ resolveApiToken: m.resolve }));
vi.mock("@/lib/store", () => ({ getOwnedBlog: vi.fn() }));
vi.mock("@/lib/mcp/tools", () => ({
  resolveMcpScopeAccess: (scopes: string[]) => scopes.includes("sync") ? "full" : "none",
  runWorkspaceToolForAuth: m.execute,
}));
import { POST } from "@/app/api/agent/commands/route";
beforeEach(() => {
  m.revoked = false; vi.clearAllMocks();
  m.resolve.mockImplementation(async () => m.revoked ? null : {
    id: "qa-connection", userId: "qa-owner", sub: "qa-owner", scopes: "sync", expiresAt: null,
  });
  m.execute.mockResolvedValue({ content: [{ type: "text", text: "command executed" }] });
});
it.each(["read_item", "update_item"])("QA10: CLI refuses %s chosen after its token is revoked during upload", async (name) => {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const request = new Request("https://texttext.app/api/agent/commands", {
    method: "POST", headers: { "content-type": "application/json" },
    body: new ReadableStream<Uint8Array>({ start(controller) { body = controller; } }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const work = POST(request);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(m.resolve).toHaveBeenCalledOnce(); expect(m.execute).not.toHaveBeenCalled();
  m.revoked = true;
  body.enqueue(new TextEncoder().encode(JSON.stringify({ name, arguments: {
    id: "11111111-1111-4111-8111-111111111111",
    ...(name === "update_item" ? { title: "Chosen after revocation" } : {}),
  } })));
  body.close();
  const response = await work;
  expect.soft(response.status).toBe(401);
  expect(m.execute).not.toHaveBeenCalled();
});
