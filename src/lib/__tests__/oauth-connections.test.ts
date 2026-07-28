import { describe, expect, it } from "vitest";
import { summarizeOAuthConnections } from "@/lib/oauth-connections";

describe("OAuth connection summaries", () => {
  it("groups grants by client and keeps the broadest scope", () => {
    const summaries = summarizeOAuthConnections([
      {
        clientId: "claude",
        name: "Claude",
        scope: "read",
        createdAt: new Date("2026-07-20T10:00:00.000Z"),
        lastUsedAt: new Date("2026-07-20T11:00:00.000Z"),
      },
      {
        clientId: "claude",
        name: "Claude",
        scope: "sync",
        createdAt: new Date("2026-07-21T10:00:00.000Z"),
        lastUsedAt: new Date("2026-07-22T11:00:00.000Z"),
      },
      {
        clientId: "chatgpt",
        name: "ChatGPT",
        scope: "read",
        createdAt: new Date("2026-07-23T10:00:00.000Z"),
        lastUsedAt: null,
      },
    ]);

    expect(summaries).toEqual([
      {
        clientId: "chatgpt",
        name: "ChatGPT",
        scope: "read",
        connectedAt: "2026-07-23T10:00:00.000Z",
        lastUsedAt: null,
        grants: 1,
      },
      {
        clientId: "claude",
        name: "Claude",
        scope: "sync",
        connectedAt: "2026-07-20T10:00:00.000Z",
        lastUsedAt: "2026-07-22T11:00:00.000Z",
        grants: 2,
      },
    ]);
  });
});
