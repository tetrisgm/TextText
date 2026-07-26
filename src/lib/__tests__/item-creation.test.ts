import { describe, expect, it } from "vitest";

import { parseItemInput } from "@/lib/item-creation";

describe("parseItemInput", () => {
  it("keeps a title-only item lightweight", () => {
    expect(parseItemInput("A quick thought")).toEqual({
      body: "",
      sourceUrl: null,
      title: "A quick thought",
    });
  });

  it("preserves pasted markdown while deriving its title", () => {
    const markdown = "# Durable local files\n\nThe body stays intact.";
    expect(parseItemInput(markdown)).toEqual({
      body: markdown,
      sourceUrl: null,
      title: "Durable local files",
    });
  });

  it("recognizes a URL without turning it into prose", () => {
    expect(parseItemInput("example.com/story")).toEqual({
      body: "",
      sourceUrl: "https://example.com/story",
      title: "",
    });
  });

  it("uses the first user prompt as the title of an imported conversation", () => {
    const transcript = [
      "ChatGPT conversation",
      "",
      "User: Explain why local files matter",
      "Assistant: Local files keep the durable source close.",
    ].join("\n");
    expect(parseItemInput(transcript)).toEqual({
      body: transcript,
      sourceUrl: null,
      title: "Explain why local files matter",
    });
  });

  it("accepts filename punctuation without using it as a path", () => {
    expect(parseItemInput("What happened?? / a field note")).toMatchObject({
      sourceUrl: null,
      title: "What happened?? / a field note",
    });
  });
});
