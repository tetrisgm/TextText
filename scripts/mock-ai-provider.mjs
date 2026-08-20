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
