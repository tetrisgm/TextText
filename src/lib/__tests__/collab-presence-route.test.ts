import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activePresence: vi.fn(),
  collabAccess: vi.fn(),
  colorForSub: vi.fn(() => "#112233"),
  getCurrentUser: vi.fn(),
  removePresence: vi.fn(),
  upsertPresence: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/collab", () => ({
  activePresence: mocks.activePresence,
  collabAccess: mocks.collabAccess,
  colorForSub: mocks.colorForSub,
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

function streamedRequest(byteCount: number): Request {
  const encoder = new TextEncoder();
  let remaining = byteCount;
  return new Request(`http://localhost/api/collab/${postId}/presence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream({
      pull(controller) {
        if (remaining === 0) {
          controller.close();
          return;
        }
        const size = Math.min(remaining, 16 * 1024);
        remaining -= size;
        controller.enqueue(encoder.encode("x".repeat(size)));
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ sub: "user-1", name: "Ada" });
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
      request({ clientId: "active", userName: "Untrusted", color: "#ffffff" }),
      context,
    );

    expect(mocks.removePresence).not.toHaveBeenCalled();
    expect(mocks.upsertPresence).toHaveBeenCalledWith(postId, {
      clientId: "active",
      userName: "Ada",
      color: "#112233",
      awareness: null,
    });
  });

  it("rejects a declared oversized presence body before storage", async () => {
    const oversized = request({ clientId: "active" });
    oversized.headers.set("content-length", String(96 * 1024 + 1));

    const response = await POST(oversized, context);

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.upsertPresence).not.toHaveBeenCalled();
  });

  it("rejects a streamed oversized presence body without Content-Length", async () => {
    const response = await POST(streamedRequest(96 * 1024 + 1), context);

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.upsertPresence).not.toHaveBeenCalled();
  });
});
