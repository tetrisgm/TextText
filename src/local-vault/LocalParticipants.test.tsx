import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ParticipantsRow } from "./LocalParticipants";

describe("local participants", () => {
  it("offers a compact item agent entry only for an open item", () => {
    const html = renderToStaticMarkup(<ParticipantsRow postId="Notes/One.textpack" />);
    expect(html).toContain('aria-label="People and agents on this item"');
    expect(html).toContain('aria-label="Add agent"');
    expect(renderToStaticMarkup(<ParticipantsRow postId={null} />)).toBe("");
  });
});
