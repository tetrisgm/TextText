import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readAssistantComposerDraft,
  resetAssistantComposerDraftsForTests,
} from "@/components/workspace/assistant/composer-store";

afterEach(() => {
  resetAssistantComposerDraftsForTests();
  vi.unstubAllGlobals();
});

describe("assistant composer drafts", () => {
  it("restores text independently for each selected context", () => {
    const values = new Map([
      ["texttext:assistant-composer:local:item:one", "Question for one"],
      ["texttext:assistant-composer:local:item:two", "Question for two"],
    ]);
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
      },
    });

    expect(readAssistantComposerDraft("local:item:one")).toEqual({
      attachments: [],
      text: "Question for one",
    });
    expect(readAssistantComposerDraft("local:item:two")).toEqual({
      attachments: [],
      text: "Question for two",
    });
  });
});
