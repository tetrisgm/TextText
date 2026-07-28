import { describe, expect, it } from "vitest";
import {
  CLOUD_AI_CATALOG,
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
});
