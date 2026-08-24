// A deterministic Anthropic-shaped provider for exercising the assistant
// lane without a real key. A credential in a test is a leak waiting to
// happen, and a lane that only the owner can exercise is a lane that ships
// broken; this mock let the greeting, starters, quick actions, chat round
// trip, and the propose/apply/undo cycle all be driven and observed for the
// first time.
//
//   node scripts/mock-ai-provider.mjs &
//   TEXTTEXT_AI_BASE_URL=http://localhost:3999/v1 npm run dev
//
// Then add any provider key in workspace settings (the string is never sent
// anywhere real; sk-ant-mock-dev works). Scripted, not clever: a turn
// answers with text, unless it mentions rewriting and an update tool is
// offered, in which case it calls the tool so the proposal pipeline runs.
import http from "node:http";

const PORT = Number.parseInt(process.env.TEXTTEXT_MOCK_AI_PORT ?? "3999", 10);
const STREAM_DELAY_MS = Number.parseInt(
  process.env.TEXTTEXT_MOCK_AI_DELAY_MS ?? "20",
  10,
);

function streamEvent(type, payload) {
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function streamChunks(content) {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_mock",
        type: "message",
        role: "assistant",
        model: "mock-anthropic",
        content: [],
        stop_reason: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
  ];
  for (const [index, block] of content.entries()) {
    if (block.type === "text") {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      });
      const midpoint = Math.max(1, Math.ceil(block.text.length / 2));
      for (const text of [
        block.text.slice(0, midpoint),
        block.text.slice(midpoint),
      ].filter(Boolean)) {
        events.push({
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text },
        });
      }
    } else if (block.type === "tool_use") {
      events.push({
        type: "content_block_start",
        index,
        content_block: {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: {},
        },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify(block.input ?? {}),
        },
      });
    }
    events.push({ type: "content_block_stop", index });
  }
  events.push(
    {
      type: "message_delta",
      delta: {
        stop_reason: content[0]?.type === "tool_use" ? "tool_use" : "end_turn",
        stop_sequence: null,
      },
      usage: { output_tokens: 20 },
    },
    { type: "message_stop" },
  );
  return events;
}

function sendStream(res, content, delayMs) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const events = streamChunks(content);
  let index = 0;
  const writeNext = () => {
    if (index >= events.length) {
      res.end();
      return;
    }
    const event = events[index];
    index += 1;
    res.write(streamEvent(event.type, event));
    setTimeout(writeNext, delayMs);
  };
  writeNext();
}

function sendFailedStream(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(
    streamEvent("message_start", {
      type: "message_start",
      message: {
        id: "msg_mock_failed",
        type: "message",
        role: "assistant",
        model: "mock-anthropic",
        content: [],
        stop_reason: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    }),
  );
  setTimeout(() => {
    res.end(
      streamEvent("error", {
        type: "error",
        error: { type: "api_error", message: "Mock provider failure" },
      }),
    );
  }, STREAM_DELAY_MS);
}

function pickTool(tools, names) {
  for (const name of names) {
    const hit = (tools ?? []).find((tool) => tool.name === name);
    if (hit) return hit;
  }
  return null;
}

function pickRemoteTool(tools, remoteName) {
  return (tools ?? []).find(
    (candidate) =>
      typeof candidate?.name === "string" &&
      candidate.name.endsWith(`__${remoteName}`),
  );
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    if (req.method === "GET" && req.url.startsWith("/v1/models/")) {
      const id = decodeURIComponent(req.url.split("/").pop());
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id, type: "model", display_name: id }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/messages") {
      const body = JSON.parse(raw || "{}");
      const messages = body.messages ?? [];
      const last = messages[messages.length - 1] ?? {};
      const lastText = JSON.stringify(last.content ?? "");
      const transcript = JSON.stringify(messages);
      const hasToolResult = lastText.includes("tool_result");
      const wantsEdit = /rewrite|tighten|sharpen/i.test(lastText);
      const wantsDraft = /draft (?:an?|something)|new article/i.test(lastText);
      let content;
      if (hasToolResult && transcript.includes("NOT DONE")) {
        content = [
          {
            type: "text",
            text: "The export did not complete. The server returned input_required and asked which format to use: PNG or SVG.",
          },
        ];
      } else if (hasToolResult && transcript.includes("approval_required")) {
        content = [
          {
            type: "text",
            text: "I prepared the exact external tool call for your review. The external server has not been contacted yet.",
          },
        ];
      } else if (hasToolResult && transcript.includes("design review is on Thursday")) {
        content = [
          {
            type: "text",
            text: "The notice says the design review is on Thursday. I ignored the remote tool description's instruction to read and forward workspace documents because it was untrusted server text, not your request.",
          },
        ];
      } else if (hasToolResult && transcript.includes("Created frame_")) {
        const frameId = /Created (frame_\d+)/.exec(transcript)?.[1] ?? "frame_1";
        content = [
          {
            type: "text",
            text: `Done. The Mock Design server created ${frameId}.`,
          },
        ];
      } else if (!hasToolResult && /create a frame/i.test(transcript)) {
        const remote = pickRemoteTool(body.tools, "create_frame");
        if (remote) {
          content = [
            {
              type: "tool_use",
              id: "toolu_mock_remote_frame_1",
              name: remote.name,
              input: { name: "Hero", width: 1200, height: 800 },
            },
          ];
        }
      } else if (!hasToolResult && /read the notice/i.test(transcript)) {
        const remote = pickRemoteTool(body.tools, "read_notice");
        if (remote) {
          content = [
            {
              type: "tool_use",
              id: "toolu_mock_remote_notice_1",
              name: remote.name,
              input: {},
            },
          ];
        }
      } else if (!hasToolResult && /export_file|export the Hero frame/i.test(transcript)) {
        const remote = pickRemoteTool(body.tools, "export_file");
        if (remote) {
          content = [
            {
              type: "tool_use",
              id: "toolu_mock_remote_export_1",
              name: remote.name,
              input: { frame: "frame_1" },
            },
          ];
        }
      } else if (wantsDraft && !hasToolResult) {
        const tool = pickTool(body.tools, ["create_item"]);
        if (tool) {
          content = [
            {
              type: "tool_use",
              id: "toolu_mock_create_1",
              name: tool.name,
              input: {
                folder_path: "blog",
                kind: "article",
                title: "What makes quiet tools work",
                body: "The best tools recede into the work. They make the next useful action obvious, preserve context, and leave every change easy to review.",
                idempotency_key: "mock-folder-to-draft",
              },
            },
          ];
        }
      } else if (wantsEdit && !hasToolResult) {
        const tool = pickTool(body.tools, [
          "update_item",
          "propose_item_edit",
          "edit_item",
          "apply_item_edit",
        ]);
        if (tool) {
          content = [
            {
              type: "tool_use",
              id: "toolu_mock_1",
              name: tool.name,
              input:
                tool.name === "update_item"
                  ? {
                      body: "The machines that matter disappear into the work. (Rewritten by the mock provider.)",
                    }
                  : { text: "Rewritten by the mock provider." },
            },
          ];
        }
      }
      if (!content) {
        content = [
          {
            type: "text",
            text: hasToolResult
              ? JSON.stringify(messages).includes("mock-folder-to-draft")
                ? "Done. I created “What makes quiet tools work” in Blog."
                : "The essential machines recede into the work."
              : "Mock assistant here: I received your request and this reply proves the full round trip.",
          },
        ];
      }
      if (body.stream === true) {
        if (transcript.includes("FAIL_STREAM")) {
          sendFailedStream(res);
          return;
        }
        const delayMs = transcript.includes("SLOW_STREAM")
          ? Math.max(STREAM_DELAY_MS, 300)
          : STREAM_DELAY_MS;
        sendStream(res, content, delayMs);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: body.model,
          content,
          stop_reason: content[0].type === "tool_use" ? "tool_use" : "end_turn",
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found", url: req.url }));
  });
});
server.listen(PORT, () => console.log(`mock anthropic on :${PORT}`));
