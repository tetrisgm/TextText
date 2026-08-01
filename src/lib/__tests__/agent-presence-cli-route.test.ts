import { beforeEach, describe, expect, it, vi } from "vitest";

// The CLI presence route: the piece that makes an agent visible in a document
// while the `texttext` CLI works on it. It authenticates with the device
// credential the app already holds, so there is no session cookie here.

const verifyTextTextApiToken = vi.fn();
const getPostStoreContext = vi.fn();
const signalWorkspaceChange = vi.fn();
const upsertPresence = vi.fn();
const removePresence = vi.fn();
const agentSelectionAtEnd = vi.fn();
const buildAgentPresence = vi.fn();

vi.mock("@/lib/mcp/auth", () => ({
  verifyTextTextApiToken: (...args: unknown[]) => verifyTextTextApiToken(...args),
}));
vi.mock("@/lib/store", () => ({
  getPostStoreContext: (...args: unknown[]) => getPostStoreContext(...args),
  signalWorkspaceChange: (...args: unknown[]) => signalWorkspaceChange(...args),
}));
vi.mock("@/lib/collab", () => ({
  upsertPresence: (...args: unknown[]) => upsertPresence(...args),
  removePresence: (...args: unknown[]) => removePresence(...args),
  agentSelectionAtEnd: (...args: unknown[]) => agentSelectionAtEnd(...args),
}));
vi.mock("@/lib/collab/agent-presence.server", () => ({
  buildAgentPresence: (...args: unknown[]) => buildAgentPresence(...args),
}));

const { POST } = await import("@/app/api/agent/presence/route");

function post(body: unknown): Request {
  return new Request("https://TextText.app/api/agent/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PRESENCE = {
  clientId: "agent-abc",
  userName: "Codex",
  color: "#111827",
  awareness: "encoded",
};

describe("POST /api/agent/presence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyTextTextApiToken.mockResolvedValue({ extra: { userId: "user-1" } });
    getPostStoreContext.mockResolvedValue({ handle: "shoku" });
    agentSelectionAtEnd.mockResolvedValue(null);
    buildAgentPresence.mockReturnValue(PRESENCE);
    upsertPresence.mockResolvedValue([]);
    removePresence.mockResolvedValue(undefined);
    signalWorkspaceChange.mockResolvedValue(undefined);
  });

  it("publishes presence for an authenticated device token", async () => {
    const response = await POST(post({ itemId: "p1", agent: "codex", active: true }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      userName: "Codex",
    });
    expect(upsertPresence).toHaveBeenCalledWith("p1", PRESENCE);
    expect(signalWorkspaceChange).toHaveBeenCalledWith("shoku");
  });

  it("rejects a caller with no device token", async () => {
    verifyTextTextApiToken.mockResolvedValue(undefined);

    const response = await POST(post({ itemId: "p1", agent: "codex" }));

    expect(response.status).toBe(401);
    expect(upsertPresence).not.toHaveBeenCalled();
  });

  it("derives identity from the token, never from the request body", async () => {
    await POST(post({ itemId: "p1", agent: "codex", userId: "someone-else" }));

    expect(buildAgentPresence).toHaveBeenCalledWith(
      { userId: "user-1", connectionName: "codex" },
      expect.anything(),
    );
  });

  it("refuses an item that is not in the workspace", async () => {
    getPostStoreContext.mockResolvedValue(null);

    const response = await POST(post({ itemId: "missing", agent: "codex" }));

    expect(response.status).toBe(404);
    expect(upsertPresence).not.toHaveBeenCalled();
  });

  it("removes the collaborator when the command finishes", async () => {
    // Blanking awareness would leave the agent lingering as a nameless
    // collaborator, so the row is deleted instead.
    const response = await POST(post({ itemId: "p1", agent: "codex", active: false }));

    expect(response.status).toBe(200);
    expect(removePresence).toHaveBeenCalledWith("p1", "agent-abc");
    expect(upsertPresence).not.toHaveBeenCalled();
  });

  it("never fails the caller when presence storage throws", async () => {
    // Presence is decoration; the CLI must not report an edit as failed.
    upsertPresence.mockRejectedValue(new Error("db down"));

    const response = await POST(post({ itemId: "p1", agent: "codex" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("requires an item and an agent name", async () => {
    const response = await POST(post({ itemId: "", agent: "" }));
    expect(response.status).toBe(400);
  });
});
