import { afterEach, describe, expect, it, vi } from "vitest";
import {
  nativeAssistantAvailable,
  nativeEmbeddedAssistantAvailable,
} from "@/lib/ai/native-client";

afterEach(() => vi.unstubAllGlobals());

function nativeWindow(embeddedAgent?: boolean) {
  return {
    __TEXTTEXT_APP__: true,
    ...(embeddedAgent === undefined
      ? {}
      : { __TEXTTEXT_EMBEDDED_AGENT__: embeddedAgent }),
    webkit: {
      messageHandlers: {
        textTextApp: { postMessage: vi.fn() },
      },
    },
  };
}

describe("native assistant capability", () => {
  it("keeps the native bridge while disabling embedded Codex in Store builds", () => {
    vi.stubGlobal("window", nativeWindow(false));

    expect(nativeAssistantAvailable()).toBe(true);
    expect(nativeEmbeddedAssistantAvailable()).toBe(false);
  });

  it("supports existing Developer ID builds that predate the capability flag", () => {
    vi.stubGlobal("window", nativeWindow());

    expect(nativeEmbeddedAssistantAvailable()).toBe(true);
  });

  it("does not expose an embedded agent on the web", () => {
    vi.stubGlobal("window", {});

    expect(nativeAssistantAvailable()).toBe(false);
    expect(nativeEmbeddedAssistantAvailable()).toBe(false);
  });
});
