import { afterEach, describe, expect, it, vi } from "vitest";
import {
  nativeAssistantAvailable,
  nativeEmbeddedAssistantAvailable,
  requestNativeAssistant,
  submitNativeAssistantTurn,
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

  it("tags native turns and cancellation with the durable chat id", () => {
    const current = nativeWindow();
    vi.stubGlobal("window", current);

    expect(
      submitNativeAssistantTurn("Continue this draft", "chat-2", [
        { role: "user", content: "Remember cobalt" },
        { role: "assistant", content: "I will remember cobalt." },
      ]),
    ).toBe(true);
    expect(requestNativeAssistant("assistantCancel", undefined, "chat-2")).toBe(
      true,
    );

    expect(
      current.webkit.messageHandlers.textTextApp.postMessage,
    ).toHaveBeenNthCalledWith(1, {
      action: "assistantTurn",
      prompt: "Continue this draft",
      conversationId: "chat-2",
      history: [
        { role: "user", content: "Remember cobalt" },
        { role: "assistant", content: "I will remember cobalt." },
      ],
    });
    expect(
      current.webkit.messageHandlers.textTextApp.postMessage,
    ).toHaveBeenNthCalledWith(2, {
      action: "assistantCancel",
      conversationId: "chat-2",
    });
  });
});
