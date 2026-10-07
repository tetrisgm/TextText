import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPresenceClient } from "./agent-presence-client";
const events = () => new EventTarget();
const emit = (target: EventTarget, detail: unknown) => target.dispatchEvent(new CustomEvent("texttext:vault-agent", { detail }));
afterEach(() => vi.useRealTimers());
describe("shared native agent presence lifecycle", () => {
  it("joins with task attribution, ignores another task ending and leaves for its own task", async () => {
    const calls: { method: string; params: Record<string, unknown> }[] = [], target = events();
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "collaborationConfig") return { itemId: "item", localFiles: true };
      return { capabilities: { nativeAgentPresence: true }, epoch: 1, presence: [], session: { clientId: "p-00000000-0000-4000-8000-000000000001", sessionCredential: "v1:fixture", expiresAt: Date.now() + 100000 } };
    });
    const client = new AgentPresenceClient(request, target);
    try {
      await client.start("Note.textpack", "task-1"); await vi.waitFor(() => expect(calls.some(c => c.method === "presenceJoin")).toBe(true));
      expect(calls.find(c => c.method === "presenceJoin")?.params.agent).toEqual({ name: "Codex", taskId: "task-1" });
      emit(target, { type: "turn-completed", taskId: "other" }); expect(calls.some(c => c.method === "presenceLeave")).toBe(false);
      emit(target, { type: "turn-completed", taskId: "task-1" });
      await vi.waitFor(() => expect(calls.some(c => c.method === "presenceLeave")).toBe(true));
      expect(calls.find(c => c.method === "presenceLeave")?.params.agent).toEqual({ name: "Codex", taskId: "task-1" });
    } finally { client.destroy(); }
  });
  it("announces an existing shared item while its local checkpoint is ahead of the file baseline", async () => {
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "collaborationConfig") return params.readyOnly ? null : { itemId: "item", localFiles: true };
      return { capabilities: { nativeAgentPresence: true }, epoch: 1, presence: [], session: { clientId: "p-00000000-0000-4000-8000-000000000001", sessionCredential: "v1:fixture", expiresAt: Date.now() + 100000 } };
    });
    const client = new AgentPresenceClient(request, events());
    try {
      await client.start("Note.textpack", "task");
      await vi.waitFor(() => expect(request.mock.calls.some(([method]) => method === "presenceJoin")).toBe(true));
      expect(request.mock.calls[0]).toEqual(["collaborationConfig", { path: "Note.textpack" }, expect.any(AbortSignal)]);
    } finally { client.destroy(); }
  });
  it("does not announce an obsolete start or an unsynced file", async () => {
    let resolve!: (value: unknown) => void;
    const request = vi.fn(() => new Promise(done => { resolve = done; }));
    const target = events(); const client = new AgentPresenceClient(request, target);
    const start = client.start("Note.textpack", "task"); emit(target, { type: "turn-cancelled", taskId: "task" });
    resolve({ itemId: "item", localFiles: true }); await start; expect(request).toHaveBeenCalledTimes(1);
    client.destroy();
    const offline = vi.fn(async () => null); const other = new AgentPresenceClient(offline, events());
    await other.start("Note.textpack", "task"); expect(offline).toHaveBeenCalledTimes(1); other.destroy();
  });
});

describe("native agent presence cleanup", () => {
  it("does not put agent identity in read requests and leaves when its native process stops", async () => {
    vi.useFakeTimers();
    const calls: { method: string; params: Record<string, unknown> }[] = [], target = events();
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "collaborationConfig") return { itemId: "item", localFiles: true };
      return { capabilities: { nativeAgentPresence: true }, epoch: 1, presence: [{ clientId: "peer", userName: "Person", color: "#123456", role: "editor" }], session: { clientId: "p-00000000-0000-4000-8000-000000000001", sessionCredential: "v1:fixture", expiresAt: Date.now() + 100000 } };
    });
    const client = new AgentPresenceClient(request, target);
    try {
      await client.start("Note.textpack", "task"); await vi.advanceTimersByTimeAsync(3100);
      expect(calls.find(call => call.method === "presenceRead")?.params).toEqual({ itemId: "item" });
      emit(target, { type: "status", state: "disconnected" }); await vi.advanceTimersByTimeAsync(1);
      expect(calls.some(call => call.method === "presenceLeave")).toBe(true);
      const count = calls.length; await vi.advanceTimersByTimeAsync(30000); expect(calls.length).toBe(count);
    } finally { client.destroy(); }
  });
  it("does not announce an agent on an older server without explicit capability", async () => {
    const request = vi.fn(async (method: string) => method === "collaborationConfig" ? { itemId: "item", localFiles: true } : { epoch: 1, presence: [] });
    const client = new AgentPresenceClient(request, events());
    await client.start("Note.textpack", "task");
    expect(request.mock.calls.map(call => call[0])).toEqual(["collaborationConfig", "presenceRead"]);
    client.destroy();
  });
  it("aborts an in-flight readiness request on unmount", async () => {
    let signal: AbortSignal | undefined;
    const request = vi.fn((_method: string, _params: Record<string, unknown>, value?: AbortSignal) => { signal = value; return new Promise(() => {}); });
    const client = new AgentPresenceClient(request, events()); void client.start("Note.textpack", "task"); client.destroy();
    expect(signal?.aborted).toBe(true);
  });
});
