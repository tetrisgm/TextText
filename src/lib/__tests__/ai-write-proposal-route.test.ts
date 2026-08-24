import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getOwnedBlog: vi.fn(),
  getUserIdBySub: vi.fn(),
  decide: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/store", () => ({
  getOwnedBlog: mocks.getOwnedBlog,
  getUserIdBySub: mocks.getUserIdBySub,
}));
vi.mock("@/lib/ai/assistant-proposal-decisions.server", () => ({
  decideAssistantProposal: mocks.decide,
}));

import { POST } from "@/app/api/ai/proposals/[id]/route";

const proposalId = "11111111-1111-4111-8111-111111111111";

function request(body: unknown) {
  return new Request(`https://texttext.app/api/ai/proposals/${proposalId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function context(id = proposalId) {
  return { params: Promise.resolve({ id }) };
}

describe("AI write proposal decision route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({
      sub: "owner-sub",
      userId: "user-1",
    });
    mocks.getOwnedBlog.mockResolvedValue({ handle: "alpha" });
    mocks.getUserIdBySub.mockResolvedValue("user-1");
    mocks.decide.mockResolvedValue({
      status: "denied",
      proposalId,
    });
  });

  it("requires an authenticated workspace owner", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(request({ decision: "approve" }), context());
    expect(response.status).toBe(401);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("accepts only an opaque id and strict decision body", async () => {
    const invalidId = await POST(
      request({ decision: "approve" }),
      context("not-a-proposal"),
    );
    const tampered = await POST(
      request({
        decision: "approve",
        arguments: { capture: "replace the stored change" },
      }),
      context(),
    );
    expect(invalidId.status).toBe(400);
    expect(tampered.status).toBe(400);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("binds the decision actor from the session rather than the body", async () => {
    const response = await POST(request({ decision: "deny" }), context());
    expect(response.status).toBe(200);
    expect(mocks.decide).toHaveBeenCalledWith({
      actor: { sub: "owner-sub", userId: "user-1", handle: "alpha" },
      proposalId,
      decision: "deny",
    });
  });

  it("returns the canonical executor receipt after approval", async () => {
    mocks.decide.mockResolvedValue({
      status: "completed",
      receipt: {
        proposalId,
        tool: "create_item",
        status: "completed",
        text: "Done.",
        output: { item: { id: "item-1", hash: "sha256:abc" } },
        completedAt: "2026-08-24T12:00:00.000Z",
      },
    });
    const response = await POST(request({ decision: "approve" }), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipt: {
        proposalId,
        output: { item: { id: "item-1", hash: "sha256:abc" } },
      },
    });
  });

  it("returns a terminal ambiguous outcome without calling it a failure", async () => {
    mocks.decide.mockResolvedValue({
      status: "ambiguous",
      proposalId,
      message:
        "The external tool may have completed. Verify it before retrying.",
    });
    const response = await POST(request({ decision: "approve" }), context());
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "ambiguous",
      proposalId,
      message:
        "The external tool may have completed. Verify it before retrying.",
    });
  });

  it.each([
    ["expired", 410],
    ["already_used", 409],
    ["not_found", 404],
  ] as const)("maps %s without exposing proposal contents", async (status, code) => {
    mocks.decide.mockResolvedValue({ status, proposalId });
    const response = await POST(request({ decision: "approve" }), context());
    expect(response.status).toBe(code);
    expect(JSON.stringify(await response.json())).not.toContain("arguments");
  });
});
