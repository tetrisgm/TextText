import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { encodePresenceAwareness } from "@/lib/collab/presence-awareness";
import { FilePresenceClient, type FilePresenceMethod, type FilePresenceRequest } from "./presence-client";

const own = "p-00000000-0000-4000-8000-000000000001";
const other = "p-00000000-0000-4000-8000-000000000002";
const session = { clientId: own, sessionCredential: "v1:fixture", expiresAt: Date.now() + 86_400_000 };
const peer = { clientId: other, userName: "Bo", color: "#3c7de0", role: "editor" as const,
  awareness: encodePresenceAwareness(0x100000000 + 17, 1, { user: { clientId: other, name: "Bo", color: "#3c7de0" }, selection: null }) };

describe("file vault presence client", () => {
  const cleanup: Array<() => void> = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { for (const destroy of cleanup.splice(0)) destroy(); vi.useRealTimers(); });
  function setup(initialPeers: typeof peer[] = []) {
    const doc = new Y.Doc(), awareness = new Awareness(doc);
    let peers = initialPeers;
    const calls: FilePresenceMethod[] = [];
    const request: FilePresenceRequest = async (method) => {
      calls.push(method);
      if (method === "presenceJoin") return { epoch: 1, presence: peers, session };
      if (method === "presenceLeave") return { epoch: 1, presence: [] };
      return { epoch: 1, presence: peers };
    };
    const onPresence = vi.fn();
    const client = new FilePresenceClient({ itemId: "item-1", awareness, request, onPresence });
    cleanup.push(() => { client.destroy(); awareness.destroy(); doc.destroy(); });
    return { client, awareness, calls, onPresence, setPeers: (next: typeof peer[]) => { peers = next; } };
  }

  it("keeps a solo visible session fresh without idle reads or document uploads", async () => {
    const { client, calls } = setup();
    expect(calls).toEqual([]);
    client.setActive(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(["presenceJoin", "presenceUpdate"]);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(calls).toEqual(["presenceJoin", "presenceUpdate", "presenceUpdate", "presenceUpdate"]);
    client.setActive(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.at(-1)).toBe("presenceLeave");
    expect(calls.filter(value => value === "presenceRead")).toHaveLength(0);
    expect(calls.filter(value => value === "presenceUpdate")).toHaveLength(3);
  });

  it("paints and removes a peer's authenticated awareness without self presence", async () => {
    const { client, awareness, calls, onPresence, setPeers } = setup([peer]);
    client.setActive(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(onPresence).toHaveBeenLastCalledWith([peer]);
    expect([...awareness.getStates().values()].some(value => value.user?.clientId === other)).toBe(true);
    setPeers([]);
    await vi.advanceTimersByTimeAsync(3_001);
    expect(calls).toContain("presenceRead");
    expect(onPresence).toHaveBeenLastCalledWith([]);
    expect([...awareness.getStates().values()].some(value => value.user?.clientId === other)).toBe(false);
  });

  it("stops a revoked session and does not retain remote selections when hidden", async () => {
    const doc = new Y.Doc(), awareness = new Awareness(doc);
    const calls: FilePresenceMethod[] = [];
    const onAccessLost = vi.fn(), onPresence = vi.fn();
    const request: FilePresenceRequest = async method => {
      calls.push(method);
      if (method === "presenceJoin") return { epoch: 1, presence: [peer], session };
      if (method === "presenceUpdate") throw Object.assign(new Error("Revoked"), { status: 403 });
      return { epoch: 1, presence: [] };
    };
    const client = new FilePresenceClient({ itemId: "item-1", awareness, request, onPresence, onAccessLost });
    cleanup.push(() => { client.destroy(); awareness.destroy(); doc.destroy(); });
    client.setActive(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(onAccessLost).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.filter(value => value === "presenceUpdate")).toHaveLength(1);
    expect(onPresence).toHaveBeenLastCalledWith([]);
    client.setActive(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.filter(value => value === "presenceJoin")).toHaveLength(1);
  });
});
