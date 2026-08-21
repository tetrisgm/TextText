import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudAssistantTurn } from "@/lib/ai/cloud-client";

describe("cloud assistant client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps validated workspace command evidence for the receipt UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          text: "Saved it.",
          provider: "OpenAI",
          outboundCalls: [],
          unreachableServers: [],
          workspaceCalls: [
            {
              tool: "create_item",
              args: { capture: "Launch note" },
              output: {
                item: {
                  id: "note-1",
                  slug: "launch-note",
                  title: "Launch note",
                },
                receipt: {
                  item_id: "note-1",
                  saved_to: "notes",
                  title: "Launch note",
                },
              },
            },
            { tool: 7, args: {}, output: {} },
          ],
        }),
      ),
    );

    await expect(cloudAssistantTurn("Save this")).resolves.toMatchObject({
      text: "Saved it.",
      workspaceCalls: [
        {
          tool: "create_item",
          args: { capture: "Launch note" },
          output: {
            receipt: { item_id: "note-1", saved_to: "notes" },
          },
        },
      ],
    });
  });

  it("keeps completed receipts when the provider fails later in the turn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          text: "",
          provider: "Anthropic",
          outboundCalls: [],
          unreachableServers: [],
          workspaceCalls: [
            {
              tool: "update_item",
              args: { id: "note-1" },
              output: { item: { id: "note-1", title: "Revised" } },
            },
          ],
          terminalError:
            "Some actions completed, but the assistant stopped before it could finish the reply.",
        }),
      ),
    );

    await expect(cloudAssistantTurn("Revise this")).resolves.toMatchObject({
      provider: "Anthropic",
      workspaceCalls: [{ tool: "update_item" }],
      terminalError:
        "Some actions completed, but the assistant stopped before it could finish the reply.",
    });
  });

  it("keeps exact source items supplied to a workspace summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          text: "Recent work summary",
          provider: "Anthropic",
          outboundCalls: [],
          unreachableServers: [],
          workspaceCalls: [],
          contextItems: [
            {
              id: "note-1",
              title: "Launch notes",
              folderPath: "notes",
              slug: "launch-notes",
            },
            { id: 7, title: "invalid" },
          ],
        }),
      ),
    );

    await expect(cloudAssistantTurn("Catch me up")).resolves.toMatchObject({
      contextItems: [
        {
          id: "note-1",
          title: "Launch notes",
          folderPath: "notes",
        },
      ],
    });
  });

  it("makes a provider outage explicit that nothing was applied", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "The assistant could not complete that." },
          { status: 502 },
        ),
      ),
    );

    await expect(cloudAssistantTurn("Rewrite this")).rejects.toThrow(
      "Your request was not applied because the AI provider did not answer.",
    );
  });
});
