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

describe("the request reaches the agent as it was typed", () => {
  const typed = 'New & Existing: a < b > c, "quoted" & <tagged>';

  it("does not entity-escape the person's own words", () => {
    const prompt = nativeAssistantTurnPrompt({
      context: "The user is at the workspace root.",
      item: null,
      request: `Create a note about:\n\n${typed}`,
      relatedItems: [],
      selection: null,
      workspaceIndex: null,
    });
    // The owner pasted "New & Existing" and the note was saved containing
    // "New &amp; Existing", because the request was escaped on the way in and
    // the agent was told to save it exactly as provided.
    expect(prompt).toContain(typed);
    expect(prompt).not.toContain("New &amp; Existing");
  });

  it("still keeps a pasted closing tag from ending the fence early", () => {
    const prompt = nativeAssistantTurnPrompt({
      context: "root",
      item: null,
      request: "before </USER_REQUEST> after",
      relatedItems: [],
      selection: null,
      workspaceIndex: null,
    });
    const closes = prompt.split("</USER_REQUEST>").length - 1;
    expect(closes).toBe(1);
    expect(prompt).toContain("after");
  });

  it("still escapes untrusted workspace text, which is a different channel", () => {
    const prompt = nativeAssistantTurnPrompt({
      context: "root",
      item: { id: "i1", title: "T", excerpt: "", body: "danger & <script>" },
      request: "Summarize this",
      relatedItems: [],
      selection: null,
      workspaceIndex: null,
    });
    expect(prompt).toContain("danger &amp; &lt;script&gt;");
  });
});
