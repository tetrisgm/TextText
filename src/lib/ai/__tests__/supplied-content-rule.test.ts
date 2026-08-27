import { describe, expect, it } from "vitest";
import {
  ASSISTANT_SYSTEM_PROMPT,
  SUPPLIED_CONTENT_RULE,
} from "@/lib/ai/system-prompt";
import { nativeAssistantTurnPrompt } from "@/lib/ai/native-turn";

/**
 * Both lanes must tell the agent the same thing about the person's own text.
 *
 * The owner pasted 2,500 words and asked for a note. They got the agent's
 * summary of it, reorganized into sections and bullets. The rule that prevents
 * that is one string, and this fails if either prompt stops carrying it, which
 * is how the two prompts would drift apart again.
 */
describe("the person's text is the person's", () => {
  it("says to keep their wording rather than improve it", () => {
    expect(SUPPLIED_CONTENT_RULE).toMatch(/save their words/i);
    expect(SUPPLIED_CONTENT_RULE).toMatch(/do not summarize/i);
  });

  it("reaches the cloud assistant", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain(SUPPLIED_CONTENT_RULE);
  });

  it("reaches the connected agent", () => {
    const prompt = nativeAssistantTurnPrompt({
      context: "The user is at the workspace root.",
      item: null,
      request: "Create a note about: some text they pasted",
      relatedItems: [],
      selection: null,
      workspaceIndex: null,
    });
    expect(prompt).toContain(SUPPLIED_CONTENT_RULE);
  });
});
