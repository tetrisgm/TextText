// The outbound client's refusals.
//
// This module makes network requests to an address a person typed. Everything
// here is about what it will NOT do: reach a private address, trust a name it
// cannot vet, or let a remote flood the model's context.

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isFetchableBookmarkUrl: vi.fn(() => true),
  hostResolvesToPublicOnly: vi.fn(async () => true),
}));

vi.mock("@/lib/bookmark-fetch", () => ({
  isFetchableBookmarkUrl: mocks.isFetchableBookmarkUrl,
  hostResolvesToPublicOnly: mocks.hostResolvesToPublicOnly,
}));

import { callRemoteTool, listRemoteTools } from "@/lib/mcp/outbound-client";

const connection = {
  id: "c1",
  name: "Figma",
  url: "https://example.com/mcp",
  token: null,
};

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.isFetchableBookmarkUrl.mockReturnValue(true);
  mocks.hostResolvesToPublicOnly.mockResolvedValue(true);
});

describe("address safety", () => {
  it("refuses a host that resolves to a private address", async () => {
    mocks.hostResolvesToPublicOnly.mockResolvedValue(false);
    await expect(listRemoteTools(connection)).rejects.toThrow(
      /does not resolve to a public address/,
    );
  });

  it("refuses plain http in the general case", async () => {
    await expect(
      listRemoteTools({ ...connection, url: "http://example.com/mcp" }),
    ).rejects.toThrow(/must be https/);
  });

  it("refuses something that is not a URL at all", async () => {
    await expect(
      listRemoteTools({ ...connection, url: "not a url" }),
    ).rejects.toThrow(/not a valid URL/);
  });
});

describe("what it accepts from a server", () => {
  it("skips tools whose names it cannot vet", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const method = JSON.parse(String(init?.body)).method;
      if (method === "initialize") return jsonResponse({ result: {} });
      return jsonResponse({
        result: {
          tools: [
            { name: "good_tool", description: "fine", inputSchema: {} },
            { name: "bad tool with spaces", description: "no", inputSchema: {} },
            { name: "../../escape", description: "no", inputSchema: {} },
            { name: "nested__separator", description: "no", inputSchema: {} },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const tools = await listRemoteTools(connection);
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("good_tool");
    expect(names).not.toContain("bad tool with spaces");
    expect(names).not.toContain("../../escape");
  });

  it("caps a description so a server cannot flood the prompt", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const method = JSON.parse(String(init?.body)).method;
      if (method === "initialize") return jsonResponse({ result: {} });
      return jsonResponse({
        result: {
          tools: [
            { name: "big", description: "x".repeat(50_000), inputSchema: {} },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [tool] = await listRemoteTools(connection);
    expect(tool.description.length).toBeLessThanOrEqual(600);
  });

  it("reads a Streamable HTTP event-stream reply", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const method = JSON.parse(String(init?.body)).method;
      if (method === "initialize") {
        return new Response('event: message\ndata: {"result":{}}\n\n', {
          status: 200,
        });
      }
      return new Response(
        'event: message\ndata: {"result":{"content":[{"type":"text","text":"done"}]}}\n\n',
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(callRemoteTool(connection, "do_it", {})).resolves.toBe("done");
  });

  it("turns a remote error result into a thrown error", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        result: { isError: true, content: [{ type: "text", text: "nope" }] },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(callRemoteTool(connection, "do_it", {})).rejects.toThrow("nope");
  });

  it("will not call a tool name it would not have listed", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      callRemoteTool(connection, "bad name", {}),
    ).rejects.toThrow(/not one we will call/);
  });

  it("says plainly when a server rejects the saved token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 401 })),
    );
    await expect(listRemoteTools(connection)).rejects.toThrow(
      /refused the access token/,
    );
  });
});
