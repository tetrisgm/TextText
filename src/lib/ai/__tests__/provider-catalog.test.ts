import { describe, expect, it } from "vitest";
import {
  CLOUD_AI_CATALOG,
  automaticCloudAiModel,
  defaultCloudAiModel,
  isCloudAiModel,
  isCloudAiProvider,
} from "@/lib/ai/provider-catalog";

describe("cloud AI provider catalog", () => {
  it("has a valid default for every provider", () => {
    for (const provider of Object.keys(CLOUD_AI_CATALOG)) {
      expect(isCloudAiProvider(provider)).toBe(true);
      if (!isCloudAiProvider(provider)) continue;
      expect(isCloudAiModel(provider, defaultCloudAiModel(provider))).toBe(true);
    }
  });

  it("rejects models from another provider", () => {
    expect(isCloudAiModel("anthropic", defaultCloudAiModel("openai"))).toBe(
      false,
    );
  });

  it("uses a fast model for simple turns and the strongest model for workspace work", () => {
    expect(
      automaticCloudAiModel("anthropic", { request: "What is this?" }),
    ).toBe("claude-haiku-4-5");
    expect(
      automaticCloudAiModel("openai", {
        request: "Compare these notes and write a sourced plan",
        hasWorkspaceContext: true,
      }),
    ).toBe("gpt-5.6");
    expect(
      automaticCloudAiModel("anthropic", {
        request: "Find the launch note",
      }),
    ).toBe("claude-sonnet-5");
    expect(
      automaticCloudAiModel("openai", {
        request: "What does this PDF contain?",
        hasAttachments: true,
      }),
    ).toBe("gpt-5.6");
  });

  it.each([
    "Summarize this draft",
    "Explain the argument",
    "Critique the structure",
    "Review this and suggest improvements",
    "Continue the document",
  ])("uses the strongest model for common document request: %s", (request) => {
    expect(automaticCloudAiModel("anthropic", { request })).toBe(
      "claude-sonnet-5",
    );
  });

  it("treats even a short follow-up as workspace work when context is open", () => {
    expect(
      automaticCloudAiModel("openai", {
        request: "Why?",
        hasWorkspaceContext: true,
      }),
    ).toBe("gpt-5.6");
  });
});
