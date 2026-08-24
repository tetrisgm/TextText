import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getOwnedBlog: vi.fn(),
  getUserIdBySub: vi.fn(),
  runWorkspaceToolForSession: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/store", () => ({
  getOwnedBlog: mocks.getOwnedBlog,
  getUserIdBySub: mocks.getUserIdBySub,
}));
vi.mock("@/lib/mcp/tools", () => ({
  runWorkspaceToolForSession: mocks.runWorkspaceToolForSession,
}));

import { POST } from "@/app/api/ai/tools/route";

function request(body: unknown) {
  return new Request("http://write.test/api/ai/tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function streamedRequest(chunks: string[], contentLength?: number) {
  const encoder = new TextEncoder();
  return new Request("http://write.test/api/ai/tools", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(contentLength === undefined
        ? {}
        : { "Content-Length": String(contentLength) }),
    },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("/api/ai/tools stable assistant transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({
      sub: "owner-sub",
      userId: "owner-id",
    });
    mocks.getOwnedBlog.mockResolvedValue({ handle: "current-workspace" });
    mocks.getUserIdBySub.mockResolvedValue("owner-id");
    mocks.runWorkspaceToolForSession.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            item: { id: "post-1", title: "A better title" },
          }),
        },
      ],
    });
  });

  it("requires a signed-in user", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await POST(
      request({
        handle: "current-workspace",
        name: "read_item",
        args: { id: "post-1" },
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.runWorkspaceToolForSession).not.toHaveBeenCalled();
  });

  it("rejects unknown commands and invalid argument containers", async () => {
    const missingWorkspace = await POST(
      request({ name: "read_item", args: { id: "post-1" } }),
    );
    const unknown = await POST(
      request({
        handle: "current-workspace",
        name: "launch_missiles",
        args: {},
      }),
    );
    const invalid = await POST(
      request({ handle: "current-workspace", name: "read_item", args: [] }),
    );

    expect(missingWorkspace.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(mocks.runWorkspaceToolForSession).not.toHaveBeenCalled();
  });

  it("refuses a collaborator or a different owned workspace", async () => {
    mocks.getOwnedBlog.mockResolvedValue({ handle: "owner-workspace" });

    const different = await POST(
      request({
        handle: "current-workspace",
        name: "read_item",
        args: { id: "post-1" },
      }),
    );
    mocks.getOwnedBlog.mockResolvedValue(null);
    const collaborator = await POST(
      request({
        handle: "current-workspace",
        name: "read_item",
        args: { id: "post-1" },
      }),
    );

    expect(different.status).toBe(403);
    expect(collaborator.status).toBe(403);
    expect(different.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.getUserIdBySub).not.toHaveBeenCalled();
    expect(mocks.runWorkspaceToolForSession).not.toHaveBeenCalled();
  });

  it("rejects a declared oversized command before parsing", async () => {
    const response = await POST(streamedRequest(["{}"], 1_100_001));

    expect(response.status).toBe(413);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.runWorkspaceToolForSession).not.toHaveBeenCalled();
  });

  it("rejects a streamed oversized command without Content-Length", async () => {
    const response = await POST(
      streamedRequest([
        '{"handle":"current-workspace","name":"read_item","args":{"id":"',
        "x".repeat(1_100_000),
        '"}}',
      ]),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.runWorkspaceToolForSession).not.toHaveBeenCalled();
  });

  it("executes the shared audited command with the session actor", async () => {
    const response = await POST(
      request({
        handle: "current-workspace",
        name: "update_item",
        args: { id: "post-1", title: "A better title" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: { item: { id: "post-1", title: "A better title" } },
    });
    expect(mocks.runWorkspaceToolForSession).toHaveBeenCalledWith(
      "update_item",
      { id: "post-1", title: "A better title" },
      {
        sub: "owner-sub",
        userId: "owner-id",
        handle: "current-workspace",
      },
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns shared command errors without exposing a stale action hash", async () => {
    mocks.runWorkspaceToolForSession.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "The item could not be saved." }],
    });

    const response = await POST(
      request({
        handle: "current-workspace",
        name: "update_item",
        args: { id: "post-1", title: "A better title" },
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "The item could not be saved.",
    });
  });

  it("returns JSON when the shared executor throws", async () => {
    mocks.runWorkspaceToolForSession.mockRejectedValue(
      new Error("database detail that should stay private"),
    );

    const response = await POST(
      request({
        handle: "current-workspace",
        name: "update_item",
        args: { id: "post-1", title: "A better title" },
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: "The workspace command failed. Try again.",
    });
  });
});
