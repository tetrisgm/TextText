import { describe, expect, it } from "vitest";
import { participantMarks } from "../participants";
import { presenceAgentIdentity } from "../assistant/agent-identity";
import { presencePeersEqual } from "@/lib/collab/usePresence";
import type { PresencePeer } from "@/lib/collab/provider";

const peer: PresencePeer = { clientId: "session-1", userName: "Ada Lovelace", color: "#fff", awareness: null };

describe("presence rows to participant marks", () => {
  it("uses the server session role, not opaque awareness or color, for people", () => {
    expect(participantMarks([{ ...peer, role: "editor" }])[0]).toMatchObject({ name: "Ada Lovelace", initials: "AL", state: "Editing", role: "Can edit this item", agent: false });
    expect(participantMarks([{ ...peer, role: "viewer", awareness: "typing=true" }])[0].state).toBe("Viewing");
    expect(participantMarks([peer])[0]).toMatchObject({ state: "Present", role: "Permission not reported" });
  });
  it("uses the shared agent identity derivation and preserves connection labels", () => {
    const agent = { ...peer, userName: "Claude · Research", participantType: "agent" as const, provider: "claude" };
    expect(presenceAgentIdentity(agent)?.name).toBe("Claude · Research");
    expect(participantMarks([agent])[0]).toMatchObject({ name: "Claude · Research", provider: "claude", agent: true, state: "Working" });
    expect(participantMarks([{ ...agent, role: "viewer" }])[0].state).toBe("Viewing");
  });
  it("never invents an idle configured assistant when no live rows exist", () => {
    expect(participantMarks([])).toEqual([]);
    expect(presenceAgentIdentity(peer)).toBeNull();
  });
  it("keeps same-name and same-provider sessions distinct with accessible connection labels", () => {
    const rows = ["b", "a"].map((clientId) => ({ ...peer, clientId, userName: "Claude", participantType: "agent" as const, provider: "claude" }));
    const marks = participantMarks(rows);
    expect(marks.map((mark) => mark.id)).toEqual(["a", "b"]);
    expect(new Set(marks.map((mark) => mark.connection)).size).toBe(2);
  });
  it("deduplicates only the same session and preserves its latest supplied state", () => {
    expect(participantMarks([{ ...peer, role: "editor" }, { ...peer, role: "viewer" }])).toHaveLength(1);
    expect(participantMarks([{ ...peer, role: "editor" }, { ...peer, role: "viewer" }])[0].state).toBe("Viewing");
  });
  it("uses safe blank-name fallbacks without trusting provider as participant type", () => {
    expect(participantMarks([{ ...peer, userName: "  ", provider: "claude" }])[0]).toMatchObject({ name: "Someone", agent: false });
    expect(participantMarks([{ ...peer, userName: "  ", participantType: "agent" }])[0].name).toBe("Agent");
    expect(participantMarks([{ ...peer, clientId: "" }])).toEqual([]);
  });
  it("keeps every participant reachable instead of slicing away overflow", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({ ...peer, clientId: String(index) }));
    expect(participantMarks(rows)).toHaveLength(12);
    expect(rows[0].clientId).toBe("0");
  });
  it("refreshes a role change even if cursor data did not change", () => {
    expect(presencePeersEqual([{ ...peer, role: "editor" }], [{ ...peer, role: "viewer" }])).toBe(false);
  });
});
