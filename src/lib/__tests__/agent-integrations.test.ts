import { describe, expect, it } from "vitest";
import {
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
