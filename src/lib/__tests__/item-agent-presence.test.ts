import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate } from "y-protocols/awareness";
import { agentPresenceClientId, buildAgentPresence } from "../collab/agent-presence.server";
describe("item connection presence", () => {
  it("uses token identity for remote grants and retains labels for local sessions", () => {
    const a = buildAgentPresence({ userId: "owner", connectionName: "Codex", connectionId: "token-a" })!;
    const b = buildAgentPresence({ userId: "owner", connectionName: "Codex", connectionId: "token-b" })!;
    expect(a.clientId).toBe(agentPresenceClientId("owner", "token-a"));
    expect(a.clientId).not.toBe(b.clientId);
    expect(a.userName).toBe(b.userName);
    expect(buildAgentPresence({ userId: "owner", connectionName: "Codex session-a" })!.clientId).toBe(agentPresenceClientId("owner", "Codex session-a"));
  });
  it("encodes read-only role in real Yjs awareness", () => {
    const presence = buildAgentPresence({ userId: "owner", connectionName: "Codex", connectionId: "token" }, { role: "viewer" })!;
    const doc = new Y.Doc(); const awareness = new Awareness(doc);
    try {
      applyAwarenessUpdate(awareness, Buffer.from(presence.awareness!, "base64"), "test");
      expect([...awareness.getStates().values()].find((state) => state.user)?.user).toMatchObject({ clientId: presence.clientId, participantType: "agent", role: "viewer" });
    } finally { awareness.destroy(); doc.destroy(); }
  });
});
