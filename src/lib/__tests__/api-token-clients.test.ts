import { describe, expect, it } from "vitest";
import { groupApiTokenClients } from "@/lib/api-token-clients";

describe("connected API clients", () => {
  it("shows rotated credentials as one disconnectable client", () => {
    expect(
      groupApiTokenClients([
        {
          id: "new",
          name: "OAuth: Codex",
          kind: "manual",
          createdAt: "2026-08-19T12:00:00.000Z",
          lastUsedAt: "2026-08-19T12:05:00.000Z",
        },
        {
          id: "old",
          name: "OAuth: Codex",
          kind: "manual",
          createdAt: "2026-08-18T12:00:00.000Z",
          lastUsedAt: "2026-08-18T12:05:00.000Z",
        },
      ]),
    ).toEqual([
      {
        key: '["manual","OAuth: Codex"]',
        name: "OAuth: Codex",
        kind: "manual",
        tokenIds: ["new", "old"],
        createdAt: "2026-08-19T12:00:00.000Z",
        lastUsedAt: "2026-08-19T12:05:00.000Z",
      },
    ]);
  });

  it("keeps different names and credential kinds separate", () => {
    const clients = groupApiTokenClients([
      {
        id: "codex",
        name: "Codex",
        kind: "mcp",
        createdAt: "2026-08-19T12:00:00.000Z",
        lastUsedAt: null,
      },
      {
        id: "app",
        name: "Codex",
        kind: "app",
        createdAt: "2026-08-20T12:00:00.000Z",
        lastUsedAt: null,
      },
    ]);
    expect(clients.map((client) => client.tokenIds)).toEqual([
      ["app"],
      ["codex"],
    ]);
  });
});
