import { describe, expect, it } from "vitest";
import {
  AGENT_INTEGRATIONS,
  AGENT_WORKFLOWS,
  CHATGPT_CONNECTOR_URL,
  CLAUDE_PLUGIN_INSTALL_COMMAND,
  CODEX_PLUGIN_INSTALL_COMMAND,
  hostedMcpUrl,
  TEXTTEXT_HOSTED_MCP_URL,
  TEXTTEXT_TOKEN_PROMPT_COMMAND,
} from "@/lib/agent-integrations";

describe("agent integrations", () => {
  it("keeps Claude, Codex, ChatGPT, and MCP as first-class entries", () => {
    expect(AGENT_INTEGRATIONS.map((integration) => integration.id)).toEqual([
      "claude",
      "codex",
      "chatgpt",
      "mcp",
    ]);
    expect(AGENT_INTEGRATIONS.map((integration) => integration.name)).toEqual([
      "Claude",
      "Codex",
      "ChatGPT",
      "Other agents",
    ]);
  });

  it("publishes native plugin installation before manual MCP setup", () => {
    expect(CLAUDE_PLUGIN_INSTALL_COMMAND).toBe(
      "claude plugin marketplace add tetrisgm/TextText && claude plugin install texttext@texttext",
    );
    expect(CODEX_PLUGIN_INSTALL_COMMAND).toBe(
      "codex plugin marketplace add tetrisgm/TextText && codex plugin add texttext@texttext",
    );
    expect(CHATGPT_CONNECTOR_URL).toBe(
      "https://chatgpt.com/#settings/Connectors",
    );
  });

  it("normalizes hosted MCP addresses", () => {
    expect(hostedMcpUrl()).toBe(TEXTTEXT_HOSTED_MCP_URL);
    expect(hostedMcpUrl("https://preview.TextText.app/")).toBe(
      "https://preview.TextText.app/api/mcp",
    );
  });

  it("prompts for plugin credentials without putting a token in a command", () => {
    expect(TEXTTEXT_TOKEN_PROMPT_COMMAND).toContain("read -rs");
    expect(TEXTTEXT_TOKEN_PROMPT_COMMAND).toContain(
      "export TEXTTEXT_WORKSPACE_TOKEN",
    );
    expect(TEXTTEXT_TOKEN_PROMPT_COMMAND).not.toContain("wsk_");

    for (const id of ["claude", "codex"] as const) {
      const integration = AGENT_INTEGRATIONS.find((entry) => entry.id === id);
      expect(integration?.steps.map((step) => step.text).join(" ")).toContain(
        "The plugin installer does not ask for it.",
      );
      expect(
        integration?.steps.some(
          (step) => step.copy?.value === TEXTTEXT_TOKEN_PROMPT_COMMAND,
        ),
      ).toBe(true);
    }
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
