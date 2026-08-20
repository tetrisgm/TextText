import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const recipesSource = readFileSync(
  new URL("../recipes/page.tsx", import.meta.url),
  "utf8",
);
const navigationSource = readFileSync(
  new URL("../../../components/docs/DocsNavigation.tsx", import.meta.url),
  "utf8",
);
const aiSource = readFileSync(
  new URL("../ai/page.tsx", import.meta.url),
  "utf8",
);
const compactAiSource = aiSource.replace(/\s+/g, " ");
const copyButtonSource = readFileSync(
  new URL("../../../components/docs/PromptCopyButton.tsx", import.meta.url),
  "utf8",
);
const connectPanelSource = readFileSync(
  new URL("../../../components/ConnectPanel.tsx", import.meta.url),
  "utf8",
);
const connectPageSource = readFileSync(
  new URL("../../connect/page.tsx", import.meta.url),
  "utf8",
);
const settingsSource = readFileSync(
  new URL(
    "../../../components/workspace/AiConnectionSettings.tsx",
    import.meta.url,
  ),
  "utf8",
);
const mcpConnectionsSource = readFileSync(
  new URL("../../../components/workspace/McpConnections.tsx", import.meta.url),
  "utf8",
);
const gettingStartedSource = readFileSync(
  new URL("../getting-started/page.tsx", import.meta.url),
  "utf8",
);
const docsIndexSource = readFileSync(
  new URL("../page.tsx", import.meta.url),
  "utf8",
);
const howItWorksSource = readFileSync(
  new URL("../how-it-works/page.tsx", import.meta.url),
  "utf8",
);
const featuresSource = readFileSync(
  new URL("../features/page.tsx", import.meta.url),
  "utf8",
);
const itemTypesSource = readFileSync(
  new URL("../item-types/page.tsx", import.meta.url),
  "utf8",
);
const proofAssets = [
  "../../../../public/docs/agentic-writing/folder-to-draft.jpg",
  "../../../../public/docs/agentic-writing/folder-to-draft-result.jpg",
  "../../../../public/docs/agentic-writing/rewrite-proposal.jpg",
  "../../../../public/docs/agentic-writing/rewrite-undo.jpg",
  "../../../../public/docs/agentic-writing/connection-ready.jpg",
] as const;

describe("the agentic writing guide", () => {
  it("keeps the six canonical workflows concrete and recoverable", () => {
    for (const recipe of [
      "Draft from notes",
      "Rewrite a selection",
      "Find related work",
      "Capture a conversation",
      "Publish and collaborate",
      "Update a project changelog",
    ]) {
      expect(recipesSource, `${recipe} recipe missing`).toContain(recipe);
    }

    expect(recipesSource).toContain("PromptCopyButton");
    expect(recipesSource).toContain("Before you start");
    expect(recipesSource).toContain("Success");
    expect(recipesSource).toContain("Undo or recover");
  });

  it("makes recipes discoverable from the documentation navigation", () => {
    expect(navigationSource).toContain('["Writing recipes", "/docs/recipes"]');
  });

  it("falls back to a real selection copy when clipboard access fails", () => {
    expect(copyButtonSource).toContain('document.createElement("textarea")');
    expect(copyButtonSource).toContain('document.execCommand("copy")');
    expect(copyButtonSource).toContain("textarea.select()");
    expect(copyButtonSource).not.toContain("Select and copy");
  });

  it("ships real JPEG proof for the workflows shown in the guide", () => {
    for (const asset of proofAssets) {
      const bytes = readFileSync(new URL(asset, import.meta.url));
      expect(bytes.subarray(0, 3).toString("hex"), asset).toBe("ffd8ff");
      expect(bytes.length, asset).toBeGreaterThan(20_000);
    }
    expect(recipesSource).toContain("folder-to-draft.jpg");
    expect(recipesSource).toContain("folder-to-draft-result.jpg");
    expect(recipesSource).toContain("rewrite-proposal.jpg");
    expect(recipesSource).toContain("rewrite-undo.jpg");
    expect(aiSource).toContain("connection-ready.jpg");
  });

  it("separates the local plugin from bearer-authenticated remote MCP", () => {
    expect(compactAiSource).toContain("TextText plugin and bundled CLI");
    expect(compactAiSource).toContain(
      "does not need a workspace token",
    );
    expect(compactAiSource).toContain("supports bearer-authenticated MCP");
    expect(compactAiSource).toContain("does not offer a bearer-token field");
    expect(aiSource).not.toContain(
      "Claude, Codex, ChatGPT, or another MCP client",
    );
  });

  it("keeps edition-specific setup out of unsupported builds", () => {
    expect(connectPanelSource).toContain("nativeEmbeddedAssistantAvailable");
    expect(connectPanelSource).toContain('"unknown"');
    expect(connectPanelSource).toContain('"standalone"');
    expect(connectPanelSource).toContain('"remote-only"');
    expect(connectPanelSource).toContain('edition === "standalone"');
    expect(connectPanelSource).toContain(
      'if (!nativeAssistantAvailable()) return "remote-only"',
    );
    expect(connectPanelSource).toContain("Set up the in-app assistant");
    expect(settingsSource).toContain('edition === "standalone"');
    expect(settingsSource).toContain("Connect a remote agent");
    expect(connectPageSource).not.toContain("CLAUDE_PLUGIN_INSTALL_COMMAND");
    expect(connectPageSource).not.toContain("CODEX_PLUGIN_INSTALL_COMMAND");
  });

  it("does not offer a loopback preset through the hosted connection form", () => {
    expect(mcpConnectionsSource).not.toContain('name: "Paper"');
    expect(mcpConnectionsSource).not.toContain("127.0.0.1:29979");
    expect(mcpConnectionsSource).toContain('name: "Linear"');
    expect(mcpConnectionsSource).toContain('type="password"');
  });

  it("scopes proposal controls and guarded audience tools to real paths", () => {
    expect(gettingStartedSource).toContain("selection Rewrite action");
    expect(gettingStartedSource).toContain(
      "ordinary freeform assistant request may update",
    );
    expect(featuresSource).toContain("selection quick actions");
    expect(featuresSource).toContain("API-key in-app assistant");
    expect(featuresSource).toContain(
      "standalone native assistant and hosted MCP",
    );
    expect(recipesSource).not.toContain(
      '"Use the in-app assistant or hosted MCP, open a finished article',
    );
  });

  it("qualifies every local plugin and consumer subscription path by edition", () => {
    expect(docsIndexSource).toContain("In the standalone Mac edition");
    expect(gettingStartedSource).toContain(
      "Using the standalone Mac edition with Claude or Codex?",
    );
    expect(howItWorksSource).toContain(
      "In the standalone Mac edition, the local",
    );
    expect(featuresSource).toContain(
      "In the standalone Mac edition, local Claude and Codex plugins",
    );
    expect(featuresSource).toContain(
      "In the standalone Mac edition, Claude and Codex on this Mac",
    );
    expect(recipesSource).toContain("In the standalone Mac edition");
    expect(aiSource).toContain(
      "From your AI app in the standalone Mac edition",
    );
    expect(aiSource).toContain("The standalone Mac plugin does not use");
  });

  it("states the item type provider requirements for each edition", () => {
    const compact = itemTypesSource.replace(/\s+/g, " ");
    expect(compact).toContain(
      "starters. They work immediately, remain fully editable, and need no provider connection.",
    );
    expect(compact).toContain(
      "Prompt-based generation in the App Store and browser editions uses a workspace Anthropic or OpenAI provider key.",
    );
    expect(compact).toContain(
      "The standalone Mac edition may instead use an eligible connected ChatGPT or Codex account.",
    );
    expect(compact).toContain(
      "A bearer-authenticated hosted MCP agent can also create the same complete item type",
    );
  });
});
