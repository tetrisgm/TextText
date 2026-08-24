import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assistantModelChoices,
  readAssistantModelPreference,
  saveAssistantModelPreference,
} from "@/components/workspace/assistant/model-preference";

function localStorageBrowser() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  return values;
}

afterEach(() => vi.unstubAllGlobals());

describe("assistant model preference", () => {
  it("offers only models allowlisted for the connected provider", () => {
    expect(assistantModelChoices("Anthropic").map((model) => model.id)).toEqual([
      "auto",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ]);
    expect(assistantModelChoices("OpenAI").map((model) => model.id)).toEqual([
      "auto",
      "gpt-5.6",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
  });

  it("persists a valid choice per workspace", () => {
    localStorageBrowser();

    expect(
      saveAssistantModelPreference("writer", "OpenAI", "gpt-5.6-luna"),
    ).toBe("gpt-5.6-luna");
    expect(readAssistantModelPreference("writer", "OpenAI")).toBe(
      "gpt-5.6-luna",
    );
  });

  it("persists automatic model selection as an explicit preference", () => {
    localStorageBrowser();

    expect(saveAssistantModelPreference("writer", "OpenAI", "auto")).toBe(
      "auto",
    );
    expect(readAssistantModelPreference("writer", "OpenAI")).toBe("auto");
  });

  it("resets to automatic selection when the connected provider changes", () => {
    const values = localStorageBrowser();
    saveAssistantModelPreference("writer", "OpenAI", "gpt-5.6-luna");

    expect(readAssistantModelPreference("writer", "Anthropic")).toBe("auto");
    expect(
      JSON.parse(values.get("texttext:assistant-model:v1:writer") ?? "{}"),
    ).toEqual({ provider: "anthropic", model: "auto" });
  });

  it("rejects an unknown or cross-provider model", () => {
    localStorageBrowser();
    expect(
      saveAssistantModelPreference("writer", "Anthropic", "gpt-5.6"),
    ).toBeNull();
    expect(
      saveAssistantModelPreference("writer", "OpenAI", "made-up-model"),
    ).toBeNull();
  });
});
