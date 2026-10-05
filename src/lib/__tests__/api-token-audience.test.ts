import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));
vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({
      limit: async () => mock.row ? [mock.row] : [],
    }) }) }) }),
  },
  executeAtomicBatch: vi.fn(),
}));

import { resolveApiToken } from "@/lib/api-tokens";

const bearer = `Bearer wsk_${"a".repeat(43)}`;
const resource = "https://texttext.app/api/mcp";

beforeEach(() => {
  mock.row = { id: "token-id", userId: "user-id", name: "ChatGPT", kind: "mcp",
    scopes: "sync", audience: resource, expiresAt: new Date(Date.now() + 60_000),
    lastUsedAt: new Date(), sub: "apple-sub" };
});

describe("OAuth access token audience", () => {
  it("accepts only the exact MCP resource, not sync or another host", async () => {
    expect(await resolveApiToken(bearer)).toBeNull();
    expect(await resolveApiToken(bearer, "https://other.example/api/mcp")).toBeNull();
    expect(await resolveApiToken(bearer, resource)).toMatchObject({ audience: resource,
      userId: "user-id", scopes: "sync" });
  });

  it("preserves manually issued tokens without an audience", async () => {
    mock.row = { ...mock.row, audience: null, kind: "manual" };
    expect(await resolveApiToken(bearer)).toMatchObject({ audience: null, kind: "manual" });
  });
});
