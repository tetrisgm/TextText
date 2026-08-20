import { describe, expect, it } from "vitest";
import {
  countMatchedTopicGroups,
  completedFinalAgentMessage,
  decodeDynamicToolArguments,
  forbiddenNativeEscape,
  hasJSONRPCID,
  jsonRPCResult,
} from "../../../../scripts/eval-native-codex-protocol.mjs";

describe("native Codex eval protocol", () => {
  it("accepts numeric zero as a JSON-RPC request id", () => {
    expect(hasJSONRPCID({ id: 0, method: "item/tool/call" })).toBe(true);
    expect(hasJSONRPCID({ id: "0", method: "item/tool/call" })).toBe(true);
    expect(hasJSONRPCID({ method: "item/tool/call" })).toBe(false);
  });

  it("preserves a numeric JSON-RPC id in the response envelope", () => {
    const response = jsonRPCResult(
      { id: 0, method: "item/tool/call" },
      { success: true },
    );

    expect(response.id).toBe(0);
    expect(typeof response.id).toBe("number");
    expect(() => jsonRPCResult({ method: "item/tool/call" }, {})).toThrow(
      "without its id",
    );
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

  it("accepts grounded topic paraphrases without coaching an exact answer", () => {
    expect(countMatchedTopicGroups(
      "You have been improving native assistant reliability and studying writing workflows.",
      [
        ["native ai", "native assistant", "reliability"],
        ["agentic writing", "writing workflow"],
        ["pinned", "fixed rails"],
      ],
    )).toBe(2);
  });

  it("rejects filesystem, shell, web, and MCP escape paths", () => {
    expect(forbiddenNativeEscape({
      id: 7,
      method: "item/tool/call",
      params: { tool: "list_items" },
    })).toBeNull();
    expect(forbiddenNativeEscape({
      id: 8,
      method: "item/commandExecution/requestApproval",
    })).toContain("unexpected App Server request");
    for (const type of ["commandExecution", "fileChange", "mcpToolCall", "webSearch"]) {
      expect(forbiddenNativeEscape({
        method: "item/started",
        params: { item: { type } },
      })).toContain(type);
    }
  });
});
