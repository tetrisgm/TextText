import { describe, expect, it } from "vitest";
import {
  TEXTTEXT_CLAUDE_CODE_MCP_CONFIG,
  TEXTTEXT_CODEX_MCP_CONFIG,
  TEXTTEXT_CURSOR_MCP_CONFIG,
  TEXTTEXT_VSCODE_MCP_CONFIG,
} from "@/lib/agent-mcp-configs";
import {
  AGENT_CONNECTION_CHECK_PROMPT,
  AGENT_INTEGRATIONS,
  AGENT_WORKFLOWS,
  CLAUDE_PLUGIN_INSTALL_COMMAND,
  CODEX_PLUGIN_INSTALL_COMMAND,
  hostedMcpUrl,
  TEXTTEXT_CLI_VERIFY_COMMAND,
  TEXTTEXT_HOSTED_MCP_URL,
} from "@/lib/agent-integrations";

describe("agent integrations", () => {
  it("leads with local Claude and Codex, then keeps hosted MCP explicit", () => {
    expect(AGENT_INTEGRATIONS.map((integration) => integration.id)).toEqual([
      "claude",
      "codex",
      "mcp",
    ]);
    expect(AGENT_INTEGRATIONS.map((integration) => integration.name)).toEqual([
      "Claude",
      "Codex",
      "Remote agents",
    ]);
  });

  it("publishes native plugin installation before manual MCP setup", () => {
    expect(CLAUDE_PLUGIN_INSTALL_COMMAND).toBe(
      "claude plugin marketplace add tetrisgm/TextText && claude plugin install texttext@texttext",
    );
    expect(CODEX_PLUGIN_INSTALL_COMMAND).toBe(
      "codex plugin marketplace add tetrisgm/TextText && codex plugin add texttext@texttext",
    );
  });

  it("normalizes hosted MCP addresses", () => {
    expect(hostedMcpUrl()).toBe(TEXTTEXT_HOSTED_MCP_URL);
    expect(hostedMcpUrl("https://preview.TextText.app/")).toBe(
      "https://preview.TextText.app/api/mcp",
    );
  });

  it("ships one channel-neutral visible connection check", () => {
    expect(AGENT_CONNECTION_CHECK_PROMPT).toContain(
      "private note with a stable idempotency key",
    );
    expect(AGENT_CONNECTION_CHECK_PROMPT).toContain("exact receipt title");
    expect(AGENT_CONNECTION_CHECK_PROMPT).toContain("exact item id back");
    expect(AGENT_CONNECTION_CHECK_PROMPT).toContain(
      "do not publish or share it",
    );
  });

  it("keeps remote bearer setup copyable without putting a token in source", () => {
    expect(TEXTTEXT_CODEX_MCP_CONFIG).toContain(
      "--bearer-token-env-var TEXTTEXT_WORKSPACE_TOKEN",
    );
    expect(TEXTTEXT_CLAUDE_CODE_MCP_CONFIG).toContain(
      "Bearer ${TEXTTEXT_WORKSPACE_TOKEN}",
    );
    expect(TEXTTEXT_CURSOR_MCP_CONFIG).toContain(
      "Bearer ${env:TEXTTEXT_WORKSPACE_TOKEN}",
    );
    expect(TEXTTEXT_VSCODE_MCP_CONFIG).toContain(
      "Bearer ${input:texttext-token}",
    );
    expect(TEXTTEXT_VSCODE_MCP_CONFIG).toContain('"password": true');
    for (const config of [
      TEXTTEXT_CODEX_MCP_CONFIG,
      TEXTTEXT_CLAUDE_CODE_MCP_CONFIG,
      TEXTTEXT_CURSOR_MCP_CONFIG,
      TEXTTEXT_VSCODE_MCP_CONFIG,
    ]) {
      expect(config).toContain(TEXTTEXT_HOSTED_MCP_URL);
      expect(config).not.toContain("wsk_");
    }
  });

  it("keeps the recommended local plugin setup token-free", () => {
    expect(TEXTTEXT_CLI_VERIFY_COMMAND).toContain("command -v texttext");
    expect(TEXTTEXT_CLI_VERIFY_COMMAND).toContain(
      "/Applications/TextText.app/Contents/Helpers/texttext ls",
    );
    for (const id of ["claude", "codex"] as const) {
      const integration = AGENT_INTEGRATIONS.find((entry) => entry.id === id);
      const serialized = JSON.stringify(integration);
      expect(serialized).toContain("standalone TextText app");
      expect(serialized).toContain(TEXTTEXT_CLI_VERIFY_COMMAND);
      expect(serialized).not.toContain("TEXTTEXT_WORKSPACE_TOKEN");
      expect(serialized).not.toContain("same Terminal");
      expect(serialized).not.toContain("/mcp");
    }
  });

  it("does not advertise an unsupported ChatGPT connection", () => {
    const serialized = JSON.stringify(AGENT_INTEGRATIONS);
    expect(serialized).not.toContain("ChatGPT");
    expect(serialized).not.toContain("own cursor");
    expect(serialized).not.toContain("name on its token");
    expect(serialized).not.toContain("TestFlight");
    expect(serialized).not.toContain("chatgpt.com/#settings/Connectors");
  });

  it("ships distinct reusable workflows", () => {
    expect(new Set(AGENT_WORKFLOWS.map((workflow) => workflow.id)).size).toBe(
      AGENT_WORKFLOWS.length,
    );
    expect(AGENT_WORKFLOWS).toHaveLength(4);
    expect(AGENT_WORKFLOWS[0]).toMatchObject({
      id: "live-document",
      title: "Use a live document canvas",
    });
    expect(
      AGENT_WORKFLOWS.every(
        (workflow) => workflow.prompt.length > workflow.title.length,
      ),
    ).toBe(true);
  });
});
