import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeAssistantConversationSyncPayloads, type SyncedAssistantConversation } from "@/lib/ai/assistant-conversation-sync";
import {
  activeAssistantConversationId,
  appendAssistantConversationMessage,
  updateAssistantConversationMessage,
  assistantConversationMessages,
  assistantConversationSyncPayload,
  assistantConversationsNeedSync,
  acknowledgeAssistantConversationSync,
  activateAssistantConversation,
  pendingAssistantProposalCount,
  resetAssistantConversationStore,
} from "../conversation-store";
import { startAssistantConversationSync, type AssistantHistorySyncStatus } from "../conversation-sync";

let browser: EventTarget;
let page: EventTarget & { visibilityState: string };
let network: { onLine: boolean };
let stops: (() => void)[];
const key = "writer:owner-a";
function message(id: string) { return { id, role: "user" as const, text: id }; }
function start(storeKey = key, sync = vi.fn(async (local: SyncedAssistantConversation[]) => ({ allowed: true, conversations: local })), isCurrent = () => true) {
  const statuses: AssistantHistorySyncStatus[] = [];
  const controller = startAssistantConversationSync({ storeKey, sync, isCurrent, onStatus: (value) => statuses.push(value) });
  stops.push(controller.dispose);
  return { ...controller, sync, statuses };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setOnline(value: boolean) {
  network.onLine = value;
  browser.dispatchEvent(new Event(value ? "online" : "offline"));
}
function setVisible(value: boolean) {
  page.visibilityState = value ? "visible" : "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
  resetAssistantConversationStore();
  const storage = new Map<string, string>();
  browser = Object.assign(new EventTarget(), {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    sessionStorage: { getItem: () => null },
  });
  page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  network = { onLine: true };
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", page);
  vi.stubGlobal("navigator", network);
  stops = [];
});
afterEach(() => {
  stops.forEach((stop) => stop());
  resetAssistantConversationStore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("owner-scoped conversation sync schedule", () => {
  it("debounces local writes and acknowledges only the server's bounded replica", async () => {
    const id = activeAssistantConversationId(key, "root")!;
    const loop = start();
    expect(loop.statuses.at(-1)).toBe("local");
    await vi.advanceTimersByTimeAsync(800);
    appendAssistantConversationMessage(key, id, message("later"));
    await vi.advanceTimersByTimeAsync(899);
    expect(loop.sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(loop.sync).toHaveBeenCalledTimes(1);
    expect(loop.statuses.slice(-2)).toEqual(["syncing", "synced"]);
    expect(assistantConversationsNeedSync(key)).toBe(false);
    activateAssistantConversation(key, "root", id);
    await vi.advanceTimersByTimeAsync(900);
    expect(loop.sync).toHaveBeenCalledTimes(1);
  });

  it.each(["reject", "denied"])("retries %s after 1, 2, 4, 8, 16 seconds, then stops", async (failure) => {
    activeAssistantConversationId(key, "root");
    const sync = vi.fn(async (..._args: [SyncedAssistantConversation[]]) => {
      void _args;
      if (failure === "reject") throw new Error("offline");
      return { allowed: false, conversations: [] };
    });
    const loop = start(key, sync);
    await vi.advanceTimersByTimeAsync(900);
    expect(sync).toHaveBeenCalledTimes(1);
    // Literal expectations deliberately do not import the implementation's schedule.
    for (const [index, delay] of [1000, 2000, 4000, 8000, 16000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(sync).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sync).toHaveBeenCalledTimes(index + 2);
    }
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sync).toHaveBeenCalledTimes(6);
    expect(loop.statuses.at(-1)).toBe("error");
    expect(assistantConversationsNeedSync(key)).toBe(true);
    loop.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sync).toHaveBeenCalledTimes(8);
  });

  it("successful recovery resets the next revision's backoff", async () => {
    const id = activeAssistantConversationId(key, "root")!;
    const sync = vi.fn(async (local: SyncedAssistantConversation[]) => ({ allowed: true, conversations: local }))
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockRejectedValueOnce(new Error("unavailable"));
    const loop = start(key, sync);
    await vi.advanceTimersByTimeAsync(3900);
    expect(sync).toHaveBeenCalledTimes(3);
    expect(loop.statuses.at(-1)).toBe("synced");
    sync.mockRejectedValueOnce(new Error("unavailable"));
    appendAssistantConversationMessage(key, id, message("next revision"));
    await vi.advanceTimersByTimeAsync(900);
    expect(sync).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(999);
    expect(sync).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(5);
    expect(loop.statuses.at(-1)).toBe("synced");
  });

  it("unmount removes the initial timer, polling, and event listeners", async () => {
    activeAssistantConversationId(key, "root");
    const loop = start();
    loop.dispose();
    browser.dispatchEvent(new Event("focus"));
    setOnline(true);
    setVisible(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(loop.sync).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a new dirty revision reopens the retry budget after exhaustion", async () => {
    const id = activeAssistantConversationId(key, "root")!;
    const sync = vi.fn(async (...args: [SyncedAssistantConversation[]]) => ({ allowed: false, conversations: args[0].slice(0, 0) }));
    start(key, sync);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(6);
    appendAssistantConversationMessage(key, id, message("new-revision"));
    await vi.advanceTimersByTimeAsync(900);
    expect(sync).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sync).toHaveBeenCalledTimes(8);
  });

  it("a dirty revision made during the last failed attempt gets its own retry budget", async () => {
    const id = activeAssistantConversationId(key, "root")!;
    const pending = deferred<{ allowed: boolean; conversations: SyncedAssistantConversation[] }>();
    let attempts = 0;
    const sync = vi.fn(async (...args: [SyncedAssistantConversation[]]) => {
      void args;
      if (++attempts === 6) return pending.promise;
      throw new Error("unavailable");
    });
    start(key, sync);
    await vi.advanceTimersByTimeAsync(31_900);
    expect(sync).toHaveBeenCalledTimes(6);
    appendAssistantConversationMessage(key, id, message("new while awaiting failure"));
    pending.resolve({ allowed: false, conversations: [] });
    await vi.advanceTimersByTimeAsync(999);
    expect(sync).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(7);
  });

  it("offline work reconnects without an edit, and success cancels the backoff", async () => {
    const id = activeAssistantConversationId(key, "root")!;
    network.onLine = false;
    const loop = start();
    appendAssistantConversationMessage(key, id, message("offline draft"));
    loop.retry();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(loop.sync).not.toHaveBeenCalled();
    expect(loop.statuses.at(-1)).toBe("offline");
    setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(loop.sync).toHaveBeenCalledTimes(1);
    expect(loop.sync.mock.calls[0][0][0].messages[0].text).toBe("offline draft");
    expect(loop.statuses.at(-1)).toBe("synced");
    await vi.advanceTimersByTimeAsync(5000);
    expect(loop.sync).toHaveBeenCalledTimes(1);
  });

  it("focus and visible events refresh clean history; hidden tabs never poll or retry", async () => {
    activeAssistantConversationId(key, "root");
    const loop = start();
    await vi.advanceTimersByTimeAsync(900);
    browser.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(loop.sync).toHaveBeenCalledTimes(2);
    setVisible(false);
    await vi.advanceTimersByTimeAsync(90_000);
    browser.dispatchEvent(new Event("focus"));
    expect(loop.sync).toHaveBeenCalledTimes(2);
    setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(loop.sync).toHaveBeenCalledTimes(3);
  });

  it("pauses a scheduled retry when hidden and resumes on foreground", async () => {
    activeAssistantConversationId(key, "root");
    const sync = vi.fn(async (...args: [SyncedAssistantConversation[]]) => ({ allowed: false, conversations: args[0].slice(0, 0) }));
    start(key, sync);
    await vi.advanceTimersByTimeAsync(900);
    setVisible(false);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(sync).toHaveBeenCalledTimes(1);
    setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("does not overlap requests or acknowledge edits made during an upload", async () => {
    const id = activeAssistantConversationId(key, "root")!;
    const pending = deferred<{ allowed: boolean; conversations: SyncedAssistantConversation[] }>();
    const sync = vi.fn(async (local: SyncedAssistantConversation[]) => ({ allowed: true, conversations: local })).mockImplementationOnce(() => pending.promise);
    const loop = start(key, sync);
    await vi.advanceTimersByTimeAsync(900);
    const uploaded = sync.mock.calls[0][0];
    appendAssistantConversationMessage(key, id, message("during upload"));
    browser.dispatchEvent(new Event("focus"));
    loop.retry();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sync).toHaveBeenCalledTimes(1);
    pending.resolve({ allowed: true, conversations: uploaded });
    await vi.advanceTimersByTimeAsync(0);
    expect(assistantConversationsNeedSync(key)).toBe(true);
    expect(loop.statuses.at(-1)).toBe("local");
    await vi.advanceTimersByTimeAsync(900);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(loop.statuses.at(-1)).toBe("synced");
    expect(assistantConversationMessages(key, id)[0].text).toBe("during upload");
  });

  it.each(["dispose", "owner-commit"])("fences late responses on %s and cannot schedule more work", async (reason) => {
    const id = activeAssistantConversationId(key, "root")!;
    const remote = assistantConversationSyncPayload(key);
    remote[0].messages.push({ ...message("remote private"), updatedAt: "2026-09-05T13:00:00Z" });
    const pending = deferred<{ allowed: boolean; conversations: SyncedAssistantConversation[] }>();
    const sync = vi.fn((...args: [SyncedAssistantConversation[]]) => { void args; return pending.promise; });
    let current = true;
    const loop = start(key, sync, () => current);
    await vi.advanceTimersByTimeAsync(900);
    const statusCount = loop.statuses.length;
    if (reason === "dispose") loop.dispose(); else current = false;
    pending.resolve({ allowed: true, conversations: remote });
    await vi.advanceTimersByTimeAsync(60_000);
    browser.dispatchEvent(new Event("focus"));
    loop.retry();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(loop.statuses).toHaveLength(statusCount);
    expect(assistantConversationMessages(key, id)).toEqual([]);
    expect(assistantConversationsNeedSync(key)).toBe(true);
    loop.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores another owner's mutations and keeps acknowledgement scoped", async () => {
    activeAssistantConversationId(key, "root");
    const loop = start();
    await vi.advanceTimersByTimeAsync(900);
    const other = "writer:owner-b";
    const id = activeAssistantConversationId(other, "root")!;
    appendAssistantConversationMessage(other, id, message("private"));
    await vi.advanceTimersByTimeAsync(900);
    expect(loop.sync).toHaveBeenCalledTimes(1);
    expect(assistantConversationsNeedSync(other)).toBe(true);
    expect(assistantConversationsNeedSync(key)).toBe(false);
  });

  it("an idle second device receives messages and terminal decisions on foreground polling", async () => {
    const id = activeAssistantConversationId(key, "root")!;
    const second = "second-device:owner-a";
    let server: SyncedAssistantConversation[] = [];
    const transport = vi.fn(async (local: SyncedAssistantConversation[]) => {
      server = mergeAssistantConversationSyncPayloads(server, local);
      return { allowed: true, conversations: server };
    });
    start(key, transport);
    start(second, transport);
    await vi.advanceTimersByTimeAsync(900);
    appendAssistantConversationMessage(key, id, {
      id: "proposal", role: "assistant", text: "Publish?",
      writeProposals: [{ id: "decision", kind: "workspace", createdAt: "2026-09-05T12:00:00Z", expiresAt: "2026-09-06T12:00:00Z", tool: "publish_item", title: "Publish", summary: "Publish item", arguments: {}, status: "pending" }],
    });
    await vi.advanceTimersByTimeAsync(900);
    expect(assistantConversationMessages(second, id)).toEqual([]);
    await vi.advanceTimersByTimeAsync(28_200);
    expect(assistantConversationMessages(second, id)[0].text).toBe("Publish?");
    expect(pendingAssistantProposalCount(second)).toBe(1);
    updateAssistantConversationMessage(key, id, "proposal", (entry) => ({
      ...entry, writeProposals: entry.writeProposals?.map((proposal) => ({ ...proposal, status: "approved", terminal: true })),
    }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pendingAssistantProposalCount(second)).toBe(0);
    expect(assistantConversationMessages(second, id)[0].writeProposals?.[0]).toMatchObject({ status: "approved", terminal: true });
    expect(assistantConversationsNeedSync(second)).toBe(false);
  });

  it("acknowledging a bounded sync copy does not strip a larger local proposal", () => {
    const id = activeAssistantConversationId(key, "root")!;
    appendAssistantConversationMessage(key, id, {
      id: "large", role: "assistant", text: "Review",
      writeProposals: [{ id: "large-proposal", kind: "workspace", createdAt: "2026-09-05T12:00:00Z", expiresAt: "2026-09-06T12:00:00Z", tool: "create_item", title: "Create", summary: "Create", status: "pending", arguments: { body: "x".repeat(50_000) } }],
    });
    acknowledgeAssistantConversationSync(key, assistantConversationSyncPayload(key));
    expect(assistantConversationsNeedSync(key)).toBe(false);
    expect(assistantConversationMessages(key, id)[0].writeProposals?.[0].arguments.body).toHaveLength(50_000);
  });
});
