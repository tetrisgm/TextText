import { afterEach, describe, expect, it, vi } from "vitest";
import { createInlinePreview, inlinePrompt, type InlineAction, type InlineEdit, type InlinePreviewRecord } from "../inline-preview";
import { previewKeyAction } from "../InlineSelectionPreview";
import { createSelectionEnvelope } from "@/lib/ai/selection-envelope";
import type { WorkspaceItemTextSnapshot } from "@/lib/ai/workspace-item-draft";

const selection = { field: "body" as const, start: 7, end: 20, text: "rough passage" };
const initial = (): WorkspaceItemTextSnapshot => ({ revision: 7, title: "Project brief", excerpt: "Old excerpt", body: "Before rough passage. After." });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(action: InlineAction = "rewrite", options: { slow?: boolean; execute?: (edit: InlineEdit) => Promise<void> } = {}) {
  let current = initial();
  let active = true;
  let signal: AbortSignal;
  let delta!: (text: string) => void;
  const answer = deferred<string>();
  const records: InlinePreviewRecord[] = [];
  const execute = vi.fn(async (edit: InlineEdit) => {
    if (options.execute) await options.execute(edit);
    current = { ...current, revision: current.revision! + 1,
      [edit.field]: current[edit.field].slice(0, edit.start) + edit.replacement_text + current[edit.field].slice(edit.end) };
  });
  const generate = vi.fn(async (envelope, _prompt, abort, onDelta) => {
    signal = abort; delta = onDelta;
    return { text: options.slow ? await answer.promise : action === "continue" ? " continued text" : "Clear passage", selectionEnvelope: envelope };
  });
  const controller = createInlinePreview({ itemId: "item", action, selection }, {
    read: async () => current, active: () => active, execute, generate,
    persist: (record) => records.push(record),
  });
  return { controller, answer, records, execute, generate, current: () => current,
    change: (patch: Partial<WorkspaceItemTextSnapshot>) => { current = { ...current, ...patch }; },
    leave: () => { active = false; }, signal: () => signal, delta: (text: string) => delta(text) };
}
const ready = async (s: ReturnType<typeof setup>) => {
  s.controller.start();
  await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
};
afterEach(() => { vi.useRealTimers(); });

describe("inline selection lifecycle", () => {
  it("streams in batches, then requires completion before an audited accept and guarded undo", async () => {
    const s = setup("rewrite", { slow: true });
    s.controller.start();
    await vi.waitFor(() => expect(s.generate).toHaveBeenCalledOnce());
    s.delta("Clear "); s.delta("passage");
    await vi.waitFor(() => expect(s.controller.snapshot().text).toBe("Clear passage"));
    await s.controller.accept();
    expect(s.execute).not.toHaveBeenCalled();
    expect(s.current()).toEqual(initial());
    s.answer.resolve("Clear passage");
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    await s.controller.accept();
    expect(s.current().body).toBe("Before Clear passage. After.");
    expect(s.execute.mock.calls[0][0].selection_envelope?.text).toBe(selection.text);
    expect(s.controller.snapshot().status).toBe("applied");
    await s.controller.undo();
    expect(s.current().body).toBe(initial().body);
    expect(s.controller.snapshot().status).toBe("undone");
    expect(s.records.map((r) => r.status)).toContain("applying");
  });
  it("discards durably and ignores a late provider completion", async () => {
    const s = setup("rewrite", { slow: true });
    s.controller.start();
    await vi.waitFor(() => expect(s.generate).toHaveBeenCalledOnce());
    expect(s.controller.discard()).toBe(true);
    expect(s.signal().aborted).toBe(true);
    s.answer.resolve("Late answer");
    await Promise.resolve();
    await s.controller.accept(); s.controller.retry();
    expect(s.controller.snapshot().status).toBe("discarded");
    expect(s.records.at(-1)?.status).toBe("discarded");
    expect(s.execute).not.toHaveBeenCalled();
  });
  it("Stop retains incomplete text without accepting it or cancelling another preview", async () => {
    const a = setup("rewrite", { slow: true });
    const b = setup("rewrite", { slow: true });
    a.controller.start(); b.controller.start();
    await vi.waitFor(() => expect(a.generate).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(b.generate).toHaveBeenCalledOnce());
    a.delta("Partial");
    await vi.waitFor(() => expect(a.controller.snapshot().text).toBe("Partial"));
    a.controller.stop();
    expect(a.signal().aborted).toBe(true);
    expect(b.signal().aborted).toBe(false);
    await a.controller.accept();
    expect(a.execute).not.toHaveBeenCalled();
    expect(a.controller.snapshot()).toMatchObject({ status: "failed", text: "Partial" });
    a.answer.resolve("Finished");
    a.controller.retry();
    await vi.waitFor(() => expect(a.controller.snapshot().status).toBe("ready"));
    b.controller.dispose();
  });
  it("marks changed text or revisions stale, and only regenerates valid selections", async () => {
    const s = setup(); await ready(s);
    s.change({ revision: 8 });
    s.controller.check(s.current());
    expect(s.controller.snapshot().status).toBe("stale");
    await s.controller.accept(); expect(s.execute).not.toHaveBeenCalled();
    s.controller.retry();
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    expect(s.controller.snapshot().envelope?.revision).toBe(8);
    s.change({ body: "Before other passage. After." });
    s.controller.check(s.current());
    s.controller.retry();
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("stale"));
    s.controller.retry({ ...selection, text: "other passage" });
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
  });
  it("checks again at acceptance and never overwrites a changed passage", async () => {
    const s = setup(); await ready(s);
    s.change({ body: "Before edited passage. After." });
    await s.controller.accept();
    expect(s.controller.snapshot().status).toBe("stale");
    expect(s.execute).not.toHaveBeenCalled();
  });
  it.each(["summarize", "continue"] as const)("%s preserves the passage and inserts after its end", async (action) => {
    const s = setup(action); await ready(s); await s.controller.accept();
    expect(s.current().body).toBe(action === "continue" ? "Before rough passage continued text. After." : "Before rough passage\n\nClear passage\n\n. After.");
    await s.controller.undo(); expect(s.current().body).toBe(initial().body);
  });
  it("offers summary replacement as an explicit secondary decision", async () => {
    const s = setup("summarize"); await ready(s); await s.controller.accept(true);
    expect(s.current().body).toBe("Before Clear passage. After.");
  });
  it("sets only document excerpt metadata with its own expected-text guard", async () => {
    const s = setup("excerpt"); await ready(s); await s.controller.accept();
    expect(s.current().body).toBe(initial().body);
    expect(s.current().excerpt).toBe("Clear passage");
    expect(s.execute.mock.calls[0][0]).toMatchObject({ field: "excerpt", expected_text: "Old excerpt" });
    await s.controller.undo(); expect(s.current().excerpt).toBe("Old excerpt");
  });
  it("refuses a duplicate accept and does not allow Discard during a write", async () => {
    const write = deferred<void>(); const s = setup("rewrite", { execute: () => write.promise });
    await ready(s);
    const first = s.controller.accept(); await s.controller.accept();
    expect(s.controller.discard()).toBe(false);
    await vi.waitFor(() => expect(s.execute).toHaveBeenCalledOnce());
    write.resolve(); await first;
    expect(s.execute).toHaveBeenCalledOnce();
  });
  it("treats an unacknowledged mutation as uncertain, with no blind retry", async () => {
    const s = setup("rewrite", { execute: async () => { throw new Error("Disconnected"); } });
    await ready(s); await s.controller.accept();
    expect(s.controller.snapshot()).toMatchObject({ status: "failed", uncertain: true });
    s.controller.retry(); await s.controller.accept();
    expect(s.execute).toHaveBeenCalledOnce();
  });
  it("refuses Undo if any later edit changed the result field", async () => {
    const s = setup(); await ready(s); await s.controller.accept();
    s.change({ body: s.current().body + " New writing." });
    await s.controller.undo();
    expect(s.execute).toHaveBeenCalledOnce();
    expect(s.controller.snapshot()).toMatchObject({ status: "applied", error: expect.stringContaining("newer text") });
  });
  it("cannot apply after owner or document teardown", async () => {
    const s = setup(); await ready(s); s.leave(); await s.controller.accept();
    expect(s.execute).not.toHaveBeenCalled();
  });
  it("rejects incomplete or mismatched coverage and permits retry", async () => {
    const s = setup();
    s.generate.mockImplementationOnce(async () => ({ text: "Partial", selectionEnvelope: await createSelectionEnvelope("other-item", initial(), selection) }));
    s.controller.start();
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("failed"));
    await s.controller.accept(); expect(s.execute).not.toHaveBeenCalled();
    s.controller.retry(); await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
  });
  it("rejects over-budget passages before contacting the provider", async () => {
    const generate = vi.fn();
    const text = "a".repeat(4001);
    const s = createInlinePreview({ itemId: "item", action: "rewrite", selection: { field: "body", start: 0, end: text.length, text } }, {
      read: async () => ({ ...initial(), body: text }), generate, execute: vi.fn(), persist: vi.fn(), active: () => true,
    });
    s.start(); await vi.waitFor(() => expect(s.snapshot().status).toBe("failed"));
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("preview keyboard and action contracts", () => {
  it("accepts Cmd+Enter only for a completed preview and never during IME", () => {
    expect(previewKeyAction("Enter", true, false, "ready")).toBe("accept");
    for (const status of ["generating", "failed", "stale", "applying", "applied"] as const) expect(previewKeyAction("Enter", true, false, status)).toBeNull();
    expect(previewKeyAction("Enter", false, false, "ready")).toBeNull();
    expect(previewKeyAction("Enter", true, true, "ready")).toBeNull();
    expect(previewKeyAction("Escape", false, false, "ready")).toBe("discard");
    expect(previewKeyAction("Escape", false, false, "applying")).toBeNull();
  });
  it("names a target language and asks for only the continuation", () => {
    expect(inlinePrompt({ itemId: "item", action: "translate", selection, language: "Japanese" })).toContain("into Japanese");
    expect(inlinePrompt({ itemId: "item", action: "continue", selection })).toContain("without repeating the selection");
  });
});
