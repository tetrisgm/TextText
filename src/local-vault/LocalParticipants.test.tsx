import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ParticipantsRow } from "./LocalParticipants";

describe("local item agent entry", () => {
  it("does not claim a person is editing merely because an item is open", () => {
    const markup = renderToStaticMarkup(createElement(ParticipantsRow, { postId: "Notes/Read-only.textpack" }));
    expect(markup).toContain('aria-label="Add agent"');
    expect(markup).toContain('aria-label="Item agent"');
    expect(markup).not.toContain("You are editing");
    expect(markup).not.toContain("vault-local-person");
  });
  it("has no item-specific action without an active item", () => {
    expect(renderToStaticMarkup(createElement(ParticipantsRow, {}))).toBe("");
  });
});
