import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptWorkspaceAiKey,
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
});
