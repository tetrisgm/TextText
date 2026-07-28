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
