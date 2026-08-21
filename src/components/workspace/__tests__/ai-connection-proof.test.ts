import { describe, expect, it } from "vitest";
import { AGENT_CONNECTION_CHECK_PROMPT } from "@/lib/agent-integrations";
import { AI_CONNECTION_PROOF_PROMPT } from "../AiConnectionSettings";

describe("in-app connection proof", () => {
  it("uses the same exact create, receipt, and read-back check as every agent", () => {
    expect(AI_CONNECTION_PROOF_PROMPT).toBe(AGENT_CONNECTION_CHECK_PROMPT);
    expect(AI_CONNECTION_PROOF_PROMPT).toContain("stable idempotency key");
    expect(AI_CONNECTION_PROOF_PROMPT).toContain("exact receipt title");
    expect(AI_CONNECTION_PROOF_PROMPT).toContain("Read that exact item id back");
  });
});
