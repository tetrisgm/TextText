import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentSelectionAtEnd: vi.fn(),
  getCollabRequestAccess: vi.fn(),
  getPostStoreContext: vi.fn(),
  signalWorkspaceChange: vi.fn(),
  upsertPresence: vi.fn(),
}));

// The route builds presence through the shared helper, which encodes real Yjs
// awareness, so keep the genuine collab implementation for everything except
// the database-backed calls this test stubs.
vi.mock("@/lib/collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collab")>()),
  agentSelectionAtEnd: mocks.agentSelectionAtEnd,
  upsertPresence: mocks.upsertPresence,
}));
vi.mock("@/lib/collab/access.server", () => ({
  getCollabRequestAccess: mocks.getCollabRequestAccess,
}));
vi.mock("@/lib/store", () => ({
  getPostStoreContext: mocks.getPostStoreContext,
  signalWorkspaceChange: mocks.signalWorkspaceChange,
}));

import { POST } from "@/app/api/collab/[postId]/agent-presence/route";

const postId = "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60";
const context = { params: Promise.resolve({ postId }) };

function request(body: unknown): Request {
  return new Request(`http://localhost/api/collab/${postId}/agent-presence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCollabRequestAccess.mockResolvedValue({
    role: "editor",
    user: { sub: "user-1", userId: "user-1" },
    capability: null,
    userName: "Ada",
    color: "#112233",
  });
  mocks.agentSelectionAtEnd.mockResolvedValue({
    field: "body",
    anchor: "AQI=",
    head: "AQI=",
  });
  mocks.upsertPresence.mockResolvedValue([]);
  mocks.getPostStoreContext.mockResolvedValue({ handle: "shoku" });
  mocks.signalWorkspaceChange.mockResolvedValue(undefined);
});

describe("agent presence route", () => {
  it("publishes a named agent collaborator for a signed-in editor", async () => {
    const response = await POST(
      request({
        actor: { connectionName: "codex-cli", clientVersion: "1.2.3" },
        activity: { kind: "edit", field: "body" },
      }),
      context,
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload.userName).toBe("Codex");
    expect(payload.activity).toBe("edit");
    expect(mocks.upsertPresence).toHaveBeenCalledWith(
      postId,
      expect.objectContaining({ userName: "Codex", color: "#111827" }),
    );
    // The cursor is placed on the field the agent is about to change.
    expect(mocks.agentSelectionAtEnd).toHaveBeenCalledWith(postId, "body");
    expect(mocks.signalWorkspaceChange).toHaveBeenCalledWith("shoku");
  });

  it("places the cursor on the declared field", async () => {
    await POST(
      request({
        actor: { connectionName: "Claude Code" },
        activity: { kind: "edit", field: "title" },
      }),
      context,
    );

    expect(mocks.agentSelectionAtEnd).toHaveBeenCalledWith(postId, "title");
  });

  it("rejects a viewer", async () => {
    mocks.getCollabRequestAccess.mockResolvedValue({
      role: "viewer",
      user: { sub: "user-1", userId: "user-1" },
      capability: null,
      userName: "Ada",
      color: "#112233",
    });

    const response = await POST(
      request({ actor: { connectionName: "codex-cli" } }),
      context,
    );

    expect(response.status).toBe(403);
    expect(mocks.upsertPresence).not.toHaveBeenCalled();
  });

  it("rejects an anonymous or capability-link caller with no user", async () => {
    mocks.getCollabRequestAccess.mockResolvedValue({
      role: "editor",
      user: null,
      capability: { id: "cap-1", role: "editor" },
      userName: "Guest",
      color: "#112233",
    });

    const response = await POST(
      request({ actor: { connectionName: "codex-cli" } }),
      context,
    );

    expect(response.status).toBe(403);
    expect(mocks.upsertPresence).not.toHaveBeenCalled();
  });

  it("requires a connection name to attribute the agent", async () => {
    const response = await POST(
      request({ actor: { connectionName: "   " } }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.upsertPresence).not.toHaveBeenCalled();
  });

  it("keeps two agent identities distinct", async () => {
    await POST(
      request({ actor: { connectionName: "codex-cli" } }),
      context,
    );
    await POST(
      request({ actor: { connectionName: "Claude Code" } }),
      context,
    );

    const [first] = mocks.upsertPresence.mock.calls[0];
    const firstEntry = mocks.upsertPresence.mock.calls[0][1];
    const secondEntry = mocks.upsertPresence.mock.calls[1][1];
    expect(first).toBe(postId);
    expect(firstEntry.clientId).not.toBe(secondEntry.clientId);
    expect(firstEntry.userName).toBe("Codex");
    expect(secondEntry.userName).toBe("Claude");
  });
});
