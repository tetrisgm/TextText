import { describe, expect, it } from "vitest";
import { replaceAllInText } from "@/lib/document-replace";

describe("replaceAllInText", () => {
  it("replaces every occurrence and counts them", () => {
    expect(replaceAllInText("a cat and a cat", "cat", "dog")).toEqual({
      text: "a dog and a dog",
      count: 2,
    });
  });

  it("is case-insensitive by default but preserves surrounding text", () => {
    expect(replaceAllInText("Cat cat CAT", "cat", "dog")).toEqual({
      text: "dog dog dog",
      count: 3,
    });
    expect(
      replaceAllInText("Cat cat", "cat", "dog", { caseSensitive: true }),
    ).toEqual({ text: "Cat dog", count: 1 });
  });

  it("treats the needle literally, not as a pattern", () => {
    expect(replaceAllInText("cost (est.) rose", "(est.)", "[est]")).toEqual({
      text: "cost [est] rose",
      count: 1,
    });
    expect(replaceAllInText("a.b axb", "a.b", "Z")).toEqual({
      text: "Z axb",
      count: 1,
    });
  });

  it("does not loop when the replacement contains the needle", () => {
    expect(replaceAllInText("cat", "cat", "cat cat")).toEqual({
      text: "cat cat",
      count: 1,
    });
  });

  it("leaves the text alone when there is nothing to find", () => {
    expect(replaceAllInText("unchanged", "", "x")).toEqual({
      text: "unchanged",
      count: 0,
    });
    expect(replaceAllInText("unchanged", "zzz", "x")).toEqual({
      text: "unchanged",
      count: 0,
    });
  });

  it("can delete by replacing with nothing", () => {
    expect(replaceAllInText("a-b-c", "-", "")).toEqual({
      text: "abc",
      count: 2,
    });
  });
});
