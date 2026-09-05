vi.mock("@/components/keyboard/CommandLayer", () => ({ useEscapeLayer: vi.fn() }));
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresencePeer } from "@/lib/collab/provider";
const fixture = vi.hoisted(() => ({ peers: [] as PresencePeer[] }));
vi.mock("@/lib/collab/usePresence", () => ({ usePresence: () => fixture.peers }));
vi.mock("@/app/editor/agent-connect-actions", () => ({ listItemAgentsAction: vi.fn(), createItemAgentAction: vi.fn(), prepareLocalItemAgentAction: vi.fn(), removeItemAgentAction: vi.fn() }));
import { ChangeReview, ParticipantsRow } from "../ParticipantsRow";

beforeEach(() => { fixture.peers = []; });
describe("participant row markup", () => {
  it("offers Add agent to the owner even with no participants", () => {
    const html = renderToStaticMarkup(<ParticipantsRow postId="item" handle="owner" canReviewChanges />);
    expect(html).toContain('aria-label="Add agent"');
    expect(html).toContain('aria-label="Close add agent"');
    expect(html).not.toContain("Copy token");
  });
  it("hides connection controls for viewers and unsaved items", () => {
    expect(renderToStaticMarkup(<ParticipantsRow postId={null} handle="owner" canReviewChanges />)).toBe("");
    expect(renderToStaticMarkup(<ParticipantsRow postId="item" handle="owner" />)).not.toContain('aria-label="Add agent"');
  });
  it("takes no space when nobody is present", () => {
    expect(renderToStaticMarkup(<ParticipantsRow postId="item" handle="owner" />)).toBe("");
  });
  it("provides named native popovers for every mark, including overflow", () => {
    fixture.peers = Array.from({ length: 8 }, (_, i) => ({ clientId: `session-${i}`, userName: "Ada", role: "editor", color: "red", awareness: null }));
    const html = renderToStaticMarkup(<ParticipantsRow postId="item" handle="owner" />);
    expect(html.match(/popover="auto"/g)).toHaveLength(8);
    // Same-name sessions stay distinguishable without exposing a row ID.
    expect(html).toContain('aria-label="Ada, Editing, Browser session 8 of 8"');
    expect(html).toContain('aria-label="Ada, Editing, Browser session 1 of 8"');
    expect(html).not.toContain("session-7");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Close participant details"');
    expect(html).not.toContain("background-color:red");
  });
  it("does not offer private history to a viewer or manufacture a latest edit", () => {
    fixture.peers = [{ clientId: "agent-1", userName: "Claude", participantType: "agent", provider: "claude", awareness: null, color: "red" }];
    const html = renderToStaticMarkup(<ParticipantsRow postId="item" handle="owner" />);
    expect(html).toContain("The workspace owner can review recorded agent changes.");
    expect(html).not.toContain(">Review changes<");
    expect(html).toContain("The current task is not reported.");
  });
  it("renders recorded text as escaped text and labels both versions", () => {
    const html = renderToStaticMarkup(<ChangeReview changes={[{ id: "record", connectionId: "connection", runId: "run", createdAt: "2026-09-05T00:00:00Z", revertsId: null, reverted: false,
      changes: [{ field: "body", before: "<script>bad()</script>", after: "new words" }] }]} />);
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Before</p>");
    expect(html).toContain("After</p>");
    expect(html).toContain("Connection: connection");
  });
});
