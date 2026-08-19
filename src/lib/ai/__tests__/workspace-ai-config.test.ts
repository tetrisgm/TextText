import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptWorkspaceAiKey,
  developmentWorkspaceAiConfig,
  encryptWorkspaceAiKey,
} from "@/lib/ai/workspace-ai-config.server";

describe("workspace AI key encryption", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores an authenticated ciphertext instead of the provider key", () => {
    vi.stubEnv("AUTH_SECRET", "test-only-auth-secret");
    const apiKey = "sk-test-value-that-must-not-leak";
    const stored = encryptWorkspaceAiKey(apiKey);

    expect(stored).not.toContain(apiKey);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(decryptWorkspaceAiKey(stored)).toBe(apiKey);
  });

  it("uses the Keychain-backed provider in development without a saved row", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TEXTTEXT_DEV_AI_PROVIDER", "anthropic");
    vi.stubEnv("TEXTTEXT_DEV_AI_KEY", "not-returned-to-callers");

    const config = developmentWorkspaceAiConfig();
    expect(config).toMatchObject({ provider: "anthropic" });
    expect(config?.apiKey).not.toContain("not-returned-to-callers");
  });

  it("never enables the development override in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TEXTTEXT_DEV_AI_PROVIDER", "anthropic");
    vi.stubEnv("TEXTTEXT_DEV_AI_KEY", "not-returned-to-callers");

    expect(developmentWorkspaceAiConfig()).toBeNull();
  });
});
