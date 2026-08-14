// The identity derivation exists because its inline copies had drifted: the
// document presence chip only knew about the native connection, so an API-key
// assistant never appeared as a collaborator. These pin the contract.

import { describe, expect, it } from "vitest";
import { assistantAgentIdentity } from "../agent-identity";

const color = (seed: string) => `color-of-${seed}`;

describe("assistantAgentIdentity", () => {
  it("an API-key connection is a real collaborator too", () => {
    const agent = assistantAgentIdentity("Anthropic", null, color);
    expect(agent).toEqual({
      name: "Claude",
      provider: "claude",
      color: "color-of-Anthropic",
      status: "connected",
    });
    expect(assistantAgentIdentity("OpenAI", null, color)?.name).toBe("OpenAI");
  });

  it("the native connection wins when both exist", () => {
    const agent = assistantAgentIdentity(
      "OpenAI",
      { state: "ready", providerLabel: "Claude subscription" },
      color,
    );
    expect(agent?.name).toBe("Claude");
    expect(agent?.provider).toBe("claude");
  });

  it("a native connection that is not ready does not count", () => {
    const agent = assistantAgentIdentity(null, { state: "runtime-missing" }, color);
    expect(agent).toBeNull();
  });

  it("working turns the status light on", () => {
    expect(assistantAgentIdentity("Anthropic", null, color, true)?.status).toBe("working");
    expect(assistantAgentIdentity("Anthropic", null, color, false)?.status).toBe("connected");
  });

  it("no connection, no ghost collaborator", () => {
    expect(assistantAgentIdentity(null, null, color)).toBeNull();
    expect(assistantAgentIdentity("", undefined, color)).toBeNull();
  });
});
