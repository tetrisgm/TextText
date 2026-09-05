import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { CollabProvider, type PresencePeer } from "@/lib/collab/provider";
import { encodePresenceAwareness } from "@/lib/collab/presence-awareness";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
  vi.unstubAllGlobals();
});
function harness() {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const onPresence = vi.fn();
  const provider = new CollabProvider(doc, {
    postId: "item", userName: "Ada", color: "#112233", canPush: true, awareness, onPresence,
  });
  // Exercise the actual network methods without starting unrelated relay loops.
  const transport = provider as unknown as {
    heartbeat(): Promise<void>;
    applyPresence(rows: PresencePeer[]): void;
    networkActive: boolean;
  };
  transport.networkActive = true;
  cleanup.push(() => { provider.destroy(); awareness.destroy(); doc.destroy(); });
  return { doc, awareness, provider, transport, onPresence };
}
function peer(clientId: string, numericId: number, clock = 1, claimedId = clientId): PresencePeer {
  return {
    clientId, userName: clientId, color: "#112233",
    awareness: encodePresenceAwareness(numericId, clock, { user: { clientId: claimedId }, marker: clock }),
  };
}
const session = () => ({ clientId: "p-test-session", sessionCredential: "test-issued-credential", expiresAt: Date.now() + 60000 });
const json = (value: unknown, status = 200) => Response.json(value, { status });

describe("authenticated provider presence", () => {
  it("joins once, carries the credential on heartbeat/leave, and excludes its own row", async () => {
    const h = harness();
    const issued = session();
    const bodies: Array<Record<string, unknown>> = [];
    const beacon = vi.fn<(url: string, body: string) => boolean>(() => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body); bodies.push(body);
      return body.join ? json({ session: issued }) : json({ presence: [peer(issued.clientId, 9)] });
    }));
    await h.transport.heartbeat();
    await h.transport.heartbeat();
    expect(bodies[0]).toEqual({ join: true, awarenessClientId: h.awareness.clientID });
    expect(bodies.filter((body) => body.join)).toHaveLength(1);
    expect(bodies[1]).toMatchObject({ clientId: issued.clientId, sessionCredential: issued.sessionCredential });
    expect(h.onPresence).toHaveBeenLastCalledWith([]);
    h.provider.destroy();
    expect(JSON.parse(beacon.mock.calls[0][1] as string)).toMatchObject({
      clientId: issued.clientId, sessionCredential: issued.sessionCredential, leave: true,
    });
  });
  it("serializes concurrent heartbeats and ignores a join finishing after teardown", async () => {
    const h = harness();
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => { resolve = done; });
    const fetch = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetch);
    const first = h.transport.heartbeat();
    await h.transport.heartbeat();
    expect(fetch).toHaveBeenCalledTimes(1);
    h.provider.destroy();
    resolve(json({ session: session() }));
    await first;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(h.onPresence).toHaveBeenLastCalledWith([]);
  });
  it("renews an expired credential on the next heartbeat", async () => {
    const h = harness();
    let joins = 0;
    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.join) {
        joins++;
        return json({ session: { ...session(), clientId: `p-session-${joins}`, expiresAt: joins === 1 ? Date.now() - 1 : Date.now() + 60000 } });
      }
      sent.push(body.clientId);
      return json({ presence: [] });
    }));
    await h.transport.heartbeat();
    await h.transport.heartbeat();
    expect(joins).toBe(2);
    expect(sent).toEqual(["p-session-1", "p-session-2"]);
  });
  it("rejoins an invalid session without stopping document synchronization", async () => {
    const h = harness();
    let joins = 0;
    let updates = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      if (JSON.parse(init.body).join) { joins++; return json({ session: session() }); }
      updates++;
      return updates === 1 ? json({ reason: "presence_session" }, 409) : json({ presence: [] });
    }));
    await h.transport.heartbeat();
    await h.transport.heartbeat();
    expect(joins).toBe(2);
    expect(updates).toBe(2);
  });
});

describe("awareness identity isolation", () => {
  it("isolates equal wire IDs and forged high clocks from a victim and the local user", () => {
    const h = harness();
    const localId = h.awareness.clientID;
    h.transport.applyPresence([peer("victim", localId), peer("attacker", localId, 100000)]);
    let states = [...h.awareness.getStates().values()];
    expect(states.find((state) => state.user?.clientId === "victim")?.marker).toBe(1);
    expect(states.find((state) => state.user?.clientId === "attacker")?.marker).toBe(100000);
    expect(h.awareness.getLocalState()?.user.clientId).toBe(h.provider.clientId);
    h.transport.applyPresence([peer("victim", localId, 2), peer("attacker", localId, 100001)]);
    states = [...h.awareness.getStates().values()];
    expect(states.find((state) => state.user?.clientId === "victim")?.marker).toBe(2);
  });
  it("rejects identity mismatches and malformed rows without blocking valid peers", () => {
    const h = harness();
    h.transport.applyPresence([
      peer("attacker", 3, 100000, "victim"),
      { ...peer("invalid", 4), awareness: "invalid" }, peer("victim", 5),
    ]);
    const states = [...h.awareness.getStates().values()];
    expect(states.filter((state) => state.user?.clientId === "victim")).toHaveLength(1);
    expect(states.some((state) => state.user?.clientId === "attacker")).toBe(false);
  });
  it("clears peers on stop and ignores a late read response", () => {
    const h = harness();
    h.transport.applyPresence([peer("victim", 10)]);
    h.provider.destroy();
    h.transport.applyPresence([peer("victim", 10, 2)]);
    expect(h.onPresence).toHaveBeenLastCalledWith([]);
    expect(h.awareness.getStates().size).toBe(0);
  });
  it("replaces an agent's changing numeric ID and removes departed peers", () => {
    const h = harness();
    h.transport.applyPresence([peer("agent-1", 10, 3)]);
    h.transport.applyPresence([peer("agent-1", 11, 1)]);
    expect([...h.awareness.getStates().values()].filter((state) => state.user?.clientId === "agent-1")).toHaveLength(1);
    h.transport.applyPresence([]);
    expect([...h.awareness.getStates().values()].filter((state) => state.user?.clientId === "agent-1")).toHaveLength(0);
  });
});
