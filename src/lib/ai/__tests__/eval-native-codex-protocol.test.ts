import { describe, expect, it } from "vitest";
import {
  completedFinalAgentMessage,
  decodeDynamicToolArguments,
  hasJSONRPCID,
} from "../../../../scripts/eval-native-codex-protocol.mjs";

describe("native Codex eval protocol", () => {
  it("accepts numeric zero as a JSON-RPC request id", () => {
    expect(hasJSONRPCID({ id: 0, method: "item/tool/call" })).toBe(true);
    expect(hasJSONRPCID({ id: "0", method: "item/tool/call" })).toBe(true);
    expect(hasJSONRPCID({ method: "item/tool/call" })).toBe(false);
  });

  it("decodes both App Server dynamic-argument encodings", () => {
    expect(decodeDynamicToolArguments({ nonce: "safe" })).toEqual({ nonce: "safe" });
    expect(decodeDynamicToolArguments('{"nonce":"safe"}')).toEqual({ nonce: "safe" });
    expect(decodeDynamicToolArguments("not json")).toEqual({});
  });

  it("uses the authoritative final agent item instead of commentary deltas", () => {
    expect(completedFinalAgentMessage({
      method: "item/completed",
      params: { item: { type: "agentMessage", phase: "commentary", text: "Calling the tool." } },
    })).toBeNull();
    expect(completedFinalAgentMessage({
      method: "item/completed",
      params: { item: { type: "agentMessage", phase: "final_answer", text: "Done" } },
    })).toBe("Done");
  });
});
