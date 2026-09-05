import { createSelectionEnvelope } from "@/lib/ai/selection-envelope";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cloudAssistantStatus,
  cloudAssistantTurn,
} from "@/lib/ai/cloud-client";

describe("cloud assistant client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([false, true])("round-trips the complete selection envelope (stream=%s)", async (stream) => {
    const text = "x".repeat(4000);
    const selectionEnvelope = await createSelectionEnvelope("note-1", { revision: 9, title: "Draft", body: text }, { field: "body", start: 0, end: 4000, text });
    const answer = { type: "complete", text: "Suggestion", provider: "OpenAI", model: "test", selectionEnvelope };
    const fetchMock = vi.fn(async () => stream ? new Response(JSON.stringify(answer) + "\n", { headers: { "Content-Type": "application/x-ndjson" } }) : Response.json(answer));
    vi.stubGlobal("fetch", fetchMock);
    const result = await cloudAssistantTurn("writer", "Rewrite", { postId: "note-1", selectionEnvelope, mode: "suggestion" }, { stream });
    expect(result).toMatchObject({ selectionEnvelope });
    const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init[1].body as string).context.selectionEnvelope).toEqual(selectionEnvelope);
  });

  it("binds status discovery to the exact displayed workspace handle", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        enabled: true,
        provider: "Anthropic",
        model: "claude-sonnet-5",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(cloudAssistantStatus(" Writer ")).resolves.toEqual({
      enabled: true,
      provider: "Anthropic",
      model: "claude-sonnet-5",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai?workspaceHandle=writer",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });

  it("fails closed before a request when the displayed handle is invalid", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(cloudAssistantStatus("not a handle")).resolves.toEqual({
      enabled: false,
      provider: null,
      model: null,
    });
    await expect(
      cloudAssistantTurn("not a handle", "Private displayed content"),
    ).rejects.toThrow("workspace could not be verified");
    expect(fetchMock).not.toHaveBeenCalled();
  });

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

    await expect(
      cloudAssistantTurn("writer", "Save this"),
    ).resolves.toMatchObject({
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

    await expect(
      cloudAssistantTurn("writer", "Revise this"),
    ).resolves.toMatchObject({
      provider: "Anthropic",
      workspaceCalls: [{ tool: "update_item" }],
      terminalError:
        "Some actions completed, but the assistant stopped before it could finish the reply.",
    });
  });

  it("keeps visible external proposal metadata without accepting bearer fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          text: "Review the Paper action.",
          provider: "Anthropic",
          outboundCalls: [],
          unreachableServers: [],
          workspaceCalls: [],
          writeProposals: [{
            id: "proposal-1",
            kind: "outbound_mcp",
            status: "pending",
            tool: "create_frame",
            title: "Run a tool on Paper",
            summary: "Create frame on Paper",
            arguments: { title: "Hero" },
            connection: {
              id: "connection-1",
              name: "Paper",
              token: "must-not-survive",
            },
            remoteTool: {
              name: "create_frame",
              description: "Create one frame",
              annotations: { readOnlyHint: false },
            },
            createdAt: "2026-08-24T12:00:00.000Z",
            expiresAt: "2026-08-24T12:15:00.000Z",
          }],
        }),
      ),
    );
    const result = await cloudAssistantTurn("writer", "Create a frame");
    expect(result).toMatchObject({
      writeProposals: [{
        kind: "outbound_mcp",
        connection: { id: "connection-1", name: "Paper" },
        remoteTool: { name: "create_frame" },
      }],
    });
    expect(JSON.stringify(result)).not.toContain("must-not-survive");
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
              operation: "Read",
            },
            { id: 7, title: "invalid" },
          ],
        }),
      ),
    );

    await expect(
      cloudAssistantTurn("writer", "Catch me up"),
    ).resolves.toMatchObject({
      contextItems: [
        {
          id: "note-1",
          title: "Launch notes",
          folderPath: "notes",
          operation: "Read",
        },
      ],
    });
  });

  it("sends bounded prior messages from the same chat before a follow-up", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.workspaceHandle).toBe("writer");
      expect(body.messages).toEqual([
        { role: "user", content: "Draft a launch note" },
        { role: "assistant", content: "Here is a first draft." },
        { role: "user", content: "Make the ending more direct" },
      ]);
      return Response.json({
        text: "Revised.",
        provider: "OpenAI",
        outboundCalls: [],
        unreachableServers: [],
        workspaceCalls: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await cloudAssistantTurn(
      "writer",
      "Make the ending more direct",
      undefined,
      {
        history: [
          { role: "user", content: "Draft a launch note" },
          { role: "assistant", content: "Here is a first draft." },
        ],
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("parses incremental cloud progress and text without waiting on JSON", async () => {
    const encoder = new TextEncoder();
    const payload = [
      { type: "start", provider: "OpenAI", model: "gpt-5.6" },
      { type: "progress", message: "Using get workspace", tool: "get_workspace" },
      { type: "text", text: "A partial answer" },
      {
        type: "complete",
        text: "A partial answer.",
        provider: "OpenAI",
        model: "gpt-5.6",
        outboundCalls: [],
        unreachableServers: [],
        workspaceCalls: [],
        contextItems: [],
      },
    ]
      .map((event) => `${JSON.stringify(event)}\n`)
      .join("");
    const first = payload.slice(0, Math.floor(payload.length / 2));
    const second = payload.slice(first.length);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(JSON.parse(String(init?.body))).toMatchObject({
          stream: true,
          model: "gpt-5.6-terra",
        });
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(first));
              controller.enqueue(encoder.encode(second));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/x-ndjson" },
          },
        );
      }),
    );
    const events: string[] = [];
    const result = await cloudAssistantTurn(
      "writer",
      "Summarize this",
      undefined,
      {
        stream: true,
        model: "gpt-5.6-terra",
        signal: new AbortController().signal,
        onEvent: (event) => events.push(event.type),
      },
    );

    expect(events).toEqual(["start", "progress", "text", "complete"]);
    expect(result).toMatchObject({
      text: "A partial answer.",
      provider: "OpenAI",
      workspaceCalls: [],
      contextItems: [],
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

    await expect(cloudAssistantTurn("writer", "Rewrite this")).rejects.toThrow(
      "Your request was not applied because the AI provider did not answer.",
    );
  });
});
