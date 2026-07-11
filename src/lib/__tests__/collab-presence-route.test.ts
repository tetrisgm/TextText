import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activePresence: vi.fn(),
  collabAccess: vi.fn(),
  getCurrentUser: vi.fn(),
  removePresence: vi.fn(),
  upsertPresence: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/collab", () => ({
  activePresence: mocks.activePresence,
  collabAccess: mocks.collabAccess,
  removePresence: mocks.removePresence,
  upsertPresence: mocks.upsertPresence,
}));

import { POST } from "@/app/api/collab/[postId]/presence/route";

const postId = "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60";
const context = { params: Promise.resolve({ postId }) };

function request(body: unknown): Request {
  return new Request(`http://localhost/api/collab/${postId}/presence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ sub: "user-1" });
  mocks.collabAccess.mockResolvedValue("editor");
  mocks.removePresence.mockResolvedValue(undefined);
  mocks.activePresence.mockResolvedValue([
    { clientId: "remaining", userName: "Grace", color: "#445566" },
  ]);
  mocks.upsertPresence.mockResolvedValue([]);
});

describe("collaboration presence route", () => {
  it("removes a leaving client instead of upserting it", async () => {
    const response = await POST(
      request({
        clientId: "leaving",
        userName: "Ada",
        color: "#112233",
        leave: true,
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.removePresence).toHaveBeenCalledWith(postId, "leaving");
    expect(mocks.upsertPresence).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      presence: [
        { clientId: "remaining", userName: "Grace", color: "#445566" },
      ],
    });
  });

  it("continues to upsert ordinary heartbeats", async () => {
    await POST(
      request({ clientId: "active", userName: " Ada ", color: "#112233" }),
      context,
    );

    expect(mocks.removePresence).not.toHaveBeenCalled();
    expect(mocks.upsertPresence).toHaveBeenCalledWith(postId, {
      clientId: "active",
      userName: "Ada",
      color: "#112233",
    });
  });
});
