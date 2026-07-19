import { afterEach, describe, expect, it, vi } from "vitest";

import { executeWorkspaceToolRequest } from "@/lib/ai/workspace-tool-client";

describe("stable assistant command client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses ordinary same-origin JSON instead of a deployment-specific action", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        result: { item: { id: "post-1", title: "A better title" } },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeWorkspaceToolRequest("current-workspace", "update_item", {
        id: "post-1",
        title: "A better title",
      }),
    ).resolves.toEqual({
      item: { id: "post-1", title: "A better title" },
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/ai/tools", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        handle: "current-workspace",
        name: "update_item",
        args: { id: "post-1", title: "A better title" },
      }),
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).not.toHaveProperty("Next-Action");
  });

  it("surfaces a useful JSON error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { error: "This item is no longer available." },
          { status: 409 },
        ),
      ),
    );

    await expect(
      executeWorkspaceToolRequest("current-workspace", "read_item", {
        id: "missing",
      }),
    ).rejects.toThrow("This item is no longer available.");
  });
});
