import { describe, expect, it, vi } from "vitest";
import {
  installLocalAgentBridge,
  LOCAL_AGENT_BRIDGE_VERSION,
  type LocalAgentBridge,
  type LocalAgentBridgeManifest,
} from "@/lib/ai/local-agent-bridge";

describe("local agent bridge", () => {
  it("installs the active workspace bridge and restores the previous bridge", () => {
    const previous: LocalAgentBridge = {
      call: vi.fn(),
      manifest: vi.fn(() => ({
        version: LOCAL_AGENT_BRIDGE_VERSION,
        context: "Previous workspace",
        view: { level: "root" },
        tools: [],
      } satisfies LocalAgentBridgeManifest)),
    };
    const current: LocalAgentBridge = {
      call: vi.fn(),
      manifest: vi.fn(() => ({
        version: LOCAL_AGENT_BRIDGE_VERSION,
        context: "Current workspace",
        view: { level: "root" },
        tools: [],
      } satisfies LocalAgentBridgeManifest)),
    };
    const host = { __TEXTTEXT_AGENT_BRIDGE__: previous };

    const uninstall = installLocalAgentBridge(host, current);

    expect(host.__TEXTTEXT_AGENT_BRIDGE__).toBe(current);
    uninstall();
    expect(host.__TEXTTEXT_AGENT_BRIDGE__).toBe(previous);
  });

  it("advertises the actor-carrying bridge version", () => {
    // The native server checks this before forwarding an agent identity.
    expect(LOCAL_AGENT_BRIDGE_VERSION).toBe(2);
  });

  it("forwards the calling agent identity to the executor", async () => {
    const call = vi.fn(async () => ({ ok: true }));
    const host: { __TEXTTEXT_AGENT_BRIDGE__?: LocalAgentBridge } = {};
    installLocalAgentBridge(host, {
      call,
      manifest: vi.fn(),
    } as unknown as LocalAgentBridge);

    const actor = {
      connectionName: "codex-cli",
      clientName: "codex-cli",
      clientVersion: "1.2.3",
    };
    await host.__TEXTTEXT_AGENT_BRIDGE__?.call(
      "open_item",
      { id: "post-1" },
      "local-mcp",
      actor,
    );

    expect(call).toHaveBeenCalledWith(
      "open_item",
      { id: "post-1" },
      "local-mcp",
      actor,
    );
  });

  it("does not remove a newer bridge during stale cleanup", () => {
    const first = {
      call: vi.fn(),
      manifest: vi.fn(),
    } as unknown as LocalAgentBridge;
    const second = {
      call: vi.fn(),
      manifest: vi.fn(),
    } as unknown as LocalAgentBridge;
    const host: { __TEXTTEXT_AGENT_BRIDGE__?: LocalAgentBridge } = {};

    const uninstallFirst = installLocalAgentBridge(host, first);
    installLocalAgentBridge(host, second);
    uninstallFirst();

    expect(host.__TEXTTEXT_AGENT_BRIDGE__).toBe(second);
  });
});
