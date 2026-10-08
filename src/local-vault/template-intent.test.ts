import { describe, expect, it } from "vitest";
import { consumeTemplateIntent } from "./template-intent";

describe("file template navigation intent", () => {
  it("selects a supported look without an automatic create and consumes reload intent", () => {
    const result = consumeTemplateIntent("https://texttext.app/vault/one?template=gallery&seed=1&item=abc#top", "one");
    expect(result?.query).toBeTruthy();
    expect(result?.url).toBe("/vault/one?item=abc#top");
    expect(consumeTemplateIntent(`https://texttext.app${result?.url}`, "one")).toBeNull();
  });
  it.each(["unknown", "../bad", "todo"])("opens the unfiltered picker for unsupported %s", slug => {
    expect(consumeTemplateIntent(`https://texttext.app/vault/one?template=${encodeURIComponent(slug)}`, "one")?.query).toBe("");
  });
  it("does not consume another workspace's intent", () => {
    expect(consumeTemplateIntent("https://texttext.app/vault/two?template=note", "one")).toBeNull();
  });
});
