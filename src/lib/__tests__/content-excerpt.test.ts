import { describe, expect, it } from "vitest";
import { plainTextExcerpt } from "../content";

describe("document excerpts", () => {
  it("shows internal link labels in writing and timeline previews", () => {
    expect(plainTextExcerpt("A thought.\n\nSource: [[article-slug|TextText setup guide]]"))
      .toBe("A thought. Source: TextText setup guide");
  });
  it("retains surrounding prose and hides Markdown formatting", () => {
    expect(plainTextExcerpt("# Heading\n**Read** [[source]] and [another](https://example.com)."))
      .toBe("Heading Read source and another.");
  });
});
