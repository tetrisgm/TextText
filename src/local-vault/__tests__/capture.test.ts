import { describe, expect, it } from "vitest";
import { captureInput } from "../CaptureDialog";

describe("URL-first capture", () => {
  it("normalizes a pasted domain into a bookmark", () => {
    expect(captureInput("example.com/article?ref=read", "")).toMatchObject({
      kind: "bookmark", sourceURL: "https://example.com/article?ref=read",
      body: "https://example.com/article?ref=read", title: "example.com",
    });
  });

  it("keeps prose containing a domain as a note", () => {
    expect(captureInput("example.com is where I found the idea", "").kind).toBe("note");
  });

  it("rejects credentials embedded in a link", () => {
    expect(() => captureInput("https://user:pass@example.com/", "")).toThrow(/username or password/);
  });
});
