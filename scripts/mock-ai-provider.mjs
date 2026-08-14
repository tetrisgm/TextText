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

const PORT = 3999;

function pickTool(tools, names) {
  for (const name of names) {
    const hit = (tools ?? []).find((tool) => tool.name === name);
    if (hit) return hit;
  }
  return null;
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
      const hasToolResult = lastText.includes("tool_result");
      const wantsEdit = /rewrite|tighten|sharpen/i.test(lastText);
      let content;
      if (wantsEdit && !hasToolResult) {
        const tool = pickTool(body.tools, [
          "update_item", "propose_item_edit", "edit_item", "apply_item_edit",
        ]);
        if (tool) {
          content = [{
            type: "tool_use",
            id: "toolu_mock_1",
            name: tool.name,
            input: tool.name === "update_item"
              ? { body: "The machines that matter disappear into the work. (Rewritten by the mock provider.)" }
              : { text: "Rewritten by the mock provider." },
          }];
        }
      }
      if (!content) {
        content = [{
          type: "text",
          text: hasToolResult
            ? "Done. I updated the document as asked."
            : "Mock assistant here: I received your request and this reply proves the full round trip.",
        }];
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "msg_mock", type: "message", role: "assistant", model: body.model,
        content,
        stop_reason: content[0].type === "tool_use" ? "tool_use" : "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found", url: req.url }));
  });
});
server.listen(PORT, () => console.log(`mock anthropic on :${PORT}`));
