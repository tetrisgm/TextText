import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/app/api/sync/v1/auth", () => ({ resolveSyncWorkspace: vi.fn() }));
vi.mock("@/lib/mcp/tools", () => ({ runWorkspaceToolForSession: vi.fn() }));
import { resolveSyncWorkspace } from "@/app/api/sync/v1/auth";
import { runWorkspaceToolForSession } from "@/lib/mcp/tools";
import { POST } from "@/app/api/app/commands/route";
const request = (body: unknown) => new Request("https://texttext.test/api/app/commands", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolveSyncWorkspace).mockResolvedValue({ sub: "owner", userId: "user", blog: { handle: "mine" } } as never);
  vi.mocked(runWorkspaceToolForSession).mockResolvedValue({ content: [{ type: "text", text: '{"item":{"id":"one"}}' }] });
});
describe("native workspace transport", () => {
  it.each(["create_item", "append_to_item", "read_item", "search"])("dispatches %s through the shared executor", async name => {
    const response = await POST(request({ name, args: { id: "one" }, handle: "foreign", actorType: "ai" }));
    expect(response.status).toBe(200);
    expect(runWorkspaceToolForSession).toHaveBeenCalledWith(name, { id: "one" }, { sub: "owner", userId: "user", handle: "mine", actorType: "human", connectionId: "native:user" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("refuses unauthenticated requests before execution", async () => {
    vi.mocked(resolveSyncWorkspace).mockResolvedValue(new Response(null, { status: 401 }));
    expect((await POST(request({ name: "search", args: {} }))).status).toBe(401);
    expect(runWorkspaceToolForSession).not.toHaveBeenCalled();
  });
  it.each(["delete_item", "set_item_status", "/api/mcp"])("does not expose %s", async name => {
    expect((await POST(request({ name, args: {} }))).status).toBe(400);
    expect(runWorkspaceToolForSession).not.toHaveBeenCalled();
  });
  it.each([null, [], "args"])("rejects malformed arguments %j", async args => {
    expect((await POST(request({ name: "search", args }))).status).toBe(400);
  });
  it("bounds command bodies", async () => {
    expect((await POST(request({ name: "create_item", args: { body: "x".repeat(1_100_001) } }))).status).toBe(400);
    expect(runWorkspaceToolForSession).not.toHaveBeenCalled();
  });
  it("surfaces conflicts rather than claiming a mutation succeeded", async () => {
    vi.mocked(runWorkspaceToolForSession).mockResolvedValue({ isError: true, content: [{ type: "text", text: "Stale version" }] });
    expect((await POST(request({ name: "append_to_item", args: {} }))).status).toBe(409);
  });
  it("does not return exception details", async () => {
    vi.mocked(runWorkspaceToolForSession).mockRejectedValue(new Error("internal detail"));
    const response = await POST(request({ name: "read_item", args: {} }));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("internal detail");
  });
});
