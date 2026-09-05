import { readFileSync } from "node:fs";
import ts from "typescript";
import { inlinePrompt as buildPrompt } from "../inline-preview";
import { appendAssistantConversationMessage, assistantConversationMessages, assistantConversationSyncPayload, createAssistantConversation, resetAssistantConversationStore, updateAssistantConversationMessage } from "../conversation-store";
import { cleanAssistantConversationSyncPayload } from "@/lib/ai/assistant-conversation-sync";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInlinePreview, inlinePrompt, type InlineAction, type InlineEdit, type InlinePreviewRecord } from "../inline-preview";
import { quickActionPrompt } from "@/lib/ai/quick-actions";
import { previewKeyAction } from "../InlineSelectionPreview";
import { createSelectionEnvelope, assertSelectionMatches, validateSelectionEnvelope } from "@/lib/ai/selection-envelope";
import type { WorkspaceItemTextSnapshot } from "@/lib/ai/workspace-item-draft";

const selection = { field: "body" as const, start: 7, end: 20, text: "rough passage" };
const initial = (): WorkspaceItemTextSnapshot => ({ revision: 7, title: "Project brief", excerpt: "Old excerpt", body: "Before rough passage. After." });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(action: InlineAction = "rewrite", options: { caret?: number; body?: string; slow?: boolean; execute?: (edit: InlineEdit) => Promise<void> } = {}) {
  let current = { ...initial(), ...(options.body !== undefined ? { body: options.body } : {}) };
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
  const controller = createInlinePreview({ itemId: "item", action, selection: options.caret === undefined ? selection : { field: "body", start: options.caret, end: options.caret, text: "" } }, {
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
  it("sets document excerpt metadata with independent source and destination guards", async () => {
    const s = setup("excerpt"); await ready(s); await s.controller.accept();
    expect(s.current().body).toBe(initial().body);
    expect(s.current().excerpt).toBe("Clear passage");
    expect(s.execute.mock.calls[0][0]).toMatchObject({ field: "excerpt", expected_text: "Old excerpt", source_precondition: s.controller.snapshot().envelope });
    expect(s.execute.mock.calls[0][0].selection_envelope).toBeUndefined();
    await s.controller.undo(); expect(s.current().excerpt).toBe("Old excerpt");
    expect(s.execute.mock.calls[1][0].source_precondition).toBeUndefined();
  });
  it("reports a remote source race as stale without accepting or retrying metadata", async () => {
    const s = setup("excerpt", { execute: async (edit) => {
      // Accept already read and checked the local snapshot. A peer's server
      // body is newer while the destination excerpt still matches exactly.
      const server = { ...initial(), body: "Peer changed the source" };
      assertSelectionMatches(await validateSelectionEnvelope(edit.source_precondition), "item", server);
    } });
    await ready(s);
    await s.controller.accept();
    expect(s.execute).toHaveBeenCalledOnce();
    expect(s.controller.snapshot()).toMatchObject({ status: "stale" });
    expect(s.controller.snapshot().uncertain).toBeUndefined();
    expect(s.current()).toEqual(initial());
    await s.controller.accept();
    expect(s.execute).toHaveBeenCalledOnce();
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


describe("inline refinement lifecycle", () => {
  it.each(["rewrite", "summarize", "excerpt", "translate", "continue"] as const)("refines current %s output using the original envelope and existing apply/undo", async (action) => {
    const s = setup(action); await ready(s);
    const original = s.controller.snapshot().envelope;
    const previous = s.controller.snapshot().text;
    s.generate.mockImplementationOnce(async (envelope) => ({ text: " Revised output ", selectionEnvelope: envelope }));
    expect(s.controller.refine("  More formal  ")).toBe(true);
    expect(s.controller.snapshot()).toMatchObject({ status: "generating", envelope: original, refinements: ["More formal"] });
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    expect(s.generate.mock.calls[1][0]).toBe(original);
    const prompt = s.generate.mock.calls[1][1];
    expect(JSON.parse(prompt.split("\n").at(-1)!)).toEqual({ originalPassage: selection.text, currentOutput: previous, instruction: "More formal" });
    expect(s.controller.snapshot().envelope).toBe(original);
    await s.controller.accept();
    const edit = s.execute.mock.calls[0][0];
    expect(edit.expected_text).toBe(action === "excerpt" ? initial().excerpt : selection.text);
    if (action !== "excerpt") expect(edit.selection_envelope).toBe(original);
    expect(s.controller.snapshot()).toMatchObject({ status: "applied", refinements: ["More formal"] });
    if (action === "continue") expect(edit.replacement_text).toBe(selection.text + " Revised output ");
    await s.controller.undo();
    expect(s.current().body).toBe(initial().body);
    expect(s.current().excerpt).toBe(initial().excerpt);
    expect(s.records.at(-1)).toMatchObject({ status: "undone", refinements: ["More formal"] });
  });
  it("chains refinements from the latest completed output and repeats the latest request without duplicate instructions", async () => {
    const s = setup(); await ready(s);
    s.generate.mockImplementationOnce(async (envelope) => ({ text: "Short output", selectionEnvelope: envelope }));
    s.controller.refine("Shorter");
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    s.controller.refine("Simplify");
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    expect(s.generate.mock.calls[2][1]).toContain('"currentOutput":"Short output"');
    s.controller.tryAgain();
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    expect(s.generate.mock.calls[3].slice(0, 2)).toEqual(s.generate.mock.calls[2].slice(0, 2));
    expect(s.controller.snapshot().refinements).toEqual(["Shorter", "Simplify"]);
    s.controller.discard();
    expect(s.records.at(-1)).toMatchObject({ status: "discarded", refinements: ["Shorter", "Simplify"] });
  });
  it("Try again repeats the base action and exact envelope without reading a new selection", async () => {
    const s = setup(); await ready(s);
    const envelope = s.controller.snapshot().envelope;
    s.controller.tryAgain(); s.controller.tryAgain();
    expect(s.controller.snapshot()).toMatchObject({ status: "generating", envelope });
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    expect(s.generate).toHaveBeenCalledTimes(2);
    expect(s.generate.mock.calls[1].slice(0, 2)).toEqual(s.generate.mock.calls[0].slice(0, 2));
    expect(s.generate.mock.calls[1][0]).toBe(envelope);
  });
  it("streams refinement in the same preview, locks actions, and fences late output on Stop", async () => {
    const s = setup(); await ready(s);
    const answer = deferred<{ text: string; selectionEnvelope: InlinePreviewRecord["envelope"] }>();
    let push!: (text: string) => void;
    s.generate.mockImplementationOnce(async (_e, _p, _s, delta) => { push = delta; return answer.promise; });
    s.controller.refine("Longer");
    expect(s.controller.refine("Shorter")).toBe(false);
    s.controller.tryAgain(); await s.controller.accept();
    await vi.waitFor(() => expect(s.generate).toHaveBeenCalledTimes(2));
    push("Partial refinement");
    await vi.waitFor(() => expect(s.controller.snapshot().text).toBe("Partial refinement"));
    s.controller.stop();
    push(" late"); answer.resolve({ text: "Late final", selectionEnvelope: s.controller.snapshot().envelope });
    await Promise.resolve();
    expect(s.controller.snapshot()).toMatchObject({ status: "failed", text: "Partial refinement", refinements: ["Longer"] });
    expect(s.execute).not.toHaveBeenCalled();
    s.controller.retry();
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    expect(s.generate.mock.calls[2].slice(0, 2)).toEqual(s.generate.mock.calls[1].slice(0, 2));
    expect(s.controller.snapshot().refinements).toEqual(["Longer"]);
  });
  it.each(["tryAgain", "refine"] as const)("%s never refreshes a stale revision into acceptance", async (operation) => {
    const s = setup(); await ready(s);
    const envelope = s.controller.snapshot().envelope;
    s.change({ revision: 8 });
    s.controller[operation]("Shorter");
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("stale"));
    expect(s.controller.snapshot().envelope).toBe(envelope);
    expect(s.generate).toHaveBeenCalledOnce();
    await s.controller.accept(); expect(s.execute).not.toHaveBeenCalled();
  });
  it("checks for passage changes during refinement and before accepting its result", async () => {
    const s = setup(); await ready(s);
    s.generate.mockImplementationOnce(async (envelope) => {
      s.change({ body: "Changed passage" });
      return { text: "Refined", selectionEnvelope: envelope };
    });
    s.controller.refine("Simplify");
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("stale"));
    await s.controller.accept(); expect(s.execute).not.toHaveBeenCalled();
    const other = setup(); await ready(other); other.controller.refine("Shorter");
    await vi.waitFor(() => expect(other.controller.snapshot().status).toBe("ready"));
    other.change({ revision: 8 }); await other.controller.accept();
    expect(other.controller.snapshot().status).toBe("stale");
    expect(other.execute).not.toHaveBeenCalled();
  });
  it("requires matching acknowledgment on refinement and retries the same refinement after failure", async () => {
    const s = setup(); await ready(s);
    s.generate.mockImplementationOnce(async () => ({ text: "Bad coverage", selectionEnvelope: undefined }));
    s.controller.refine("Shorter");
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("failed"));
    await s.controller.accept(); expect(s.execute).not.toHaveBeenCalled();
    s.controller.retry({ ...selection, text: "unrelated" });
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    expect(s.generate.mock.calls[2].slice(0, 2)).toEqual(s.generate.mock.calls[1].slice(0, 2));
  });
  it("rejects empty instructions and all non-Ready refinement/try-again calls", async () => {
    const s = setup();
    expect(s.controller.refine("Shorter")).toBe(false); s.controller.tryAgain();
    expect(s.generate).not.toHaveBeenCalled();
    await ready(s);
    expect(s.controller.refine(" \n ")).toBe(false);
    expect(s.controller.snapshot().status).toBe("ready");
    await s.controller.accept();
    expect(s.controller.refine("Shorter")).toBe(false); s.controller.tryAgain();
    await s.controller.undo();
    expect(s.controller.refine("Shorter")).toBe(false); s.controller.tryAgain();
    expect(s.generate).toHaveBeenCalledOnce();
  });
  it("rejects refinement while Applying or after an uncertain write", async () => {
    const write = deferred<void>(); const s = setup("rewrite", { execute: () => write.promise });
    await ready(s); const applying = s.controller.accept();
    expect(s.controller.refine("Shorter")).toBe(false); s.controller.tryAgain();
    await vi.waitFor(() => expect(s.execute).toHaveBeenCalledOnce());
    write.reject(new Error("Disconnected")); await applying;
    expect(s.controller.refine("Shorter")).toBe(false); s.controller.tryAgain(); s.controller.retry();
    expect(s.generate).toHaveBeenCalledOnce();
  });
  it.each(["discard", "dispose"] as const)("fences a pending refinement on %s", async (operation) => {
    const s = setup(); await ready(s);
    const answer = deferred<{ text: string; selectionEnvelope: InlinePreviewRecord["envelope"] }>();
    s.generate.mockImplementationOnce(async () => answer.promise);
    s.controller.refine("Shorter");
    await vi.waitFor(() => expect(s.generate).toHaveBeenCalledTimes(2));
    const envelope = s.controller.snapshot().envelope;
    s.controller[operation](); answer.resolve({ text: "Late", selectionEnvelope: envelope });
    await Promise.resolve(); await Promise.resolve();
    expect(s.controller.snapshot().status).toBe(operation === "discard" ? "discarded" : "failed");
    await s.controller.accept(); expect(s.execute).not.toHaveBeenCalled();
  });
  it("regeneration of a reselected stale passage resets refinement history", async () => {
    const s = setup(); await ready(s); s.controller.refine("Shorter");
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    s.change({ body: "Before other passage. After." }); s.controller.check(s.current());
    s.controller.retry({ ...selection, text: "other passage" });
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    expect(s.controller.snapshot().refinements).toBeUndefined();
    s.controller.refine("Simplify");
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    expect(s.generate.mock.calls.at(-1)![1]).toContain('"originalPassage":"other passage"');
  });
});

describe("inline refinement prompts", () => {
  it.each(["rewrite", "summarize", "excerpt", "translate", "continue"] as const)("retains %s action context with source, output, instruction and replacement-only requirements", (action) => {
    const request = { itemId: "item", action, selection, language: "Japanese" };
    const prompt = inlinePrompt(request, { currentOutput: 'Current "output"\n', instruction: "  Make it warmer  " });
    expect(prompt).toContain(inlinePrompt(request).split(" Return only the suggested text.")[0]);
    expect(prompt).toContain("Return the replacement text only");
    expect(prompt).toContain("Do not change the item.");
    expect(JSON.parse(prompt.split("\n").at(-1)!)).toEqual({ originalPassage: selection.text, currentOutput: 'Current "output"\n', instruction: "Make it warmer" });
  });
});


describe("inline refinement history integration", () => {
  it("uses the production preview hook callback to update one durable message through refinement and decision", async () => {
    // Execute the real callback with a deterministic provider and the real history
    // store, without mounting unrelated owner/provider hooks.
    const source = readFileSync("src/components/workspace/assistant/useNativeAssistant.ts", "utf8");
    const callback = source.slice(source.indexOf("  const createSelectionPreview = useCallback("), source.indexOf("  const runQuickAction = useCallback("));
    const compiled = ts.transpileModule(callback, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    resetAssistantConversationStore();
    const local = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => local.set(key, value),
      removeItem: (key: string) => local.delete(key),
    }, sessionStorage: { getItem: () => null } });
    const storeKey = "inline-refinement-history";
    const conversation = createAssistantConversation(storeKey, "item:item");
    const append = vi.fn((_thread, role, text) => {
      appendAssistantConversationMessage(storeKey, conversation, { id: "one-preview", role, text });
      return "one-preview";
    });
    const cloud = vi.fn(async (_handle, _prompt, context, options) => {
      options.onEvent({ type: "text", text: "Streamed output" });
      return { text: "Completed output", selectionEnvelope: context.selectionEnvelope };
    });
    const dependencies = {
      useCallback: (fn: unknown) => fn, ownerScopeReady: true, conversationStoreKey: storeKey,
      getViewRef: { current: () => ({ postId: "item", level: "edit" }) },
      currentOwnerScopeRef: { current: { owner: "owner" } }, threadKey: "thread",
      assistantOwnerScopeMatches: () => true, appendToThread: append, createInlinePreview,
      readItemTextRef: { current: async () => initial() }, cloudAssistantTurn: cloud,
      handle: "writer", selectedCloudModel: null, tools: { executor: vi.fn() },
      workspaceMutationQueued: () => false, inlinePrompt: buildPrompt,
      updateThreadMessage: (_thread: string, id: string, update: Parameters<typeof updateAssistantConversationMessage>[3]) =>
        updateAssistantConversationMessage(storeKey, conversation, id, update),
    };
    const factory = new Function(...Object.keys(dependencies), `${compiled}; return createSelectionPreview;`)(...Object.values(dependencies));
    try {
      const preview = await factory({ itemId: "item", action: "rewrite", selection });
      preview.start(); await vi.waitFor(() => expect(preview.snapshot().status).toBe("ready"));
      preview.refine("Shorter"); await vi.waitFor(() => expect(preview.snapshot().status).toBe("ready"));
      preview.refine("More formal"); await vi.waitFor(() => expect(preview.snapshot().status).toBe("ready"));
      preview.tryAgain(); await vi.waitFor(() => expect(preview.snapshot().status).toBe("ready"));
      preview.discard();
      expect(append).toHaveBeenCalledOnce();
      expect(cloud).toHaveBeenCalledTimes(4);
      expect(cloud.mock.calls[2][1]).toContain('"instruction":"More formal"');
      const messages = assistantConversationMessages(storeKey, conversation);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ id: "one-preview", text: "Completed output", inlinePreview: {
        status: "discarded", refinements: ["Shorter", "More formal"], envelope: { text: selection.text },
      } });
      const roundTrip = cleanAssistantConversationSyncPayload(JSON.parse(JSON.stringify(assistantConversationSyncPayload(storeKey))));
      expect(roundTrip[0].messages).toHaveLength(1);
      expect(roundTrip[0].messages[0].inlinePreview).toMatchObject({ status: "discarded", refinements: ["Shorter", "More formal"] });
    } finally { resetAssistantConversationStore(); vi.unstubAllGlobals(); }
  });
});


describe("inline caret lifecycle", () => {
  it.each([0, 7, initial().body.length])("inserts at caret %i and undoes only that exact text", async (caret) => {
    const s = setup("continue", { caret }); await ready(s);
    expect(s.controller.snapshot()).toMatchObject({ words: 0, status: "ready", envelope: { start: caret, end: caret, text: "" } });
    expect(s.generate.mock.calls[0][1]).toContain(quickActionPrompt("continue", initial(), { field: "body", start: caret, end: caret, text: "" }));
    await s.controller.accept();
    expect(s.execute.mock.calls[0][0]).toMatchObject({ start: caret, end: caret, expected_text: "", replacement_text: " continued text", selection_envelope: s.controller.snapshot().envelope });
    expect(s.current().body).toBe(initial().body.slice(0, caret) + " continued text" + initial().body.slice(caret));
    await s.controller.undo();
    expect(s.current().body).toBe(initial().body);
    expect(s.execute.mock.calls[1][0]).toEqual({ field: "body", start: caret, end: caret + " continued text".length, expected_text: " continued text", replacement_text: "" });
    expect(s.records.map((record) => record.status)).toEqual(expect.arrayContaining(["generating", "ready", "applying", "applied", "undone"]));
  });
  it("drafts into an empty document with the same guarded controller", async () => {
    const s = setup("continue", { caret: 0, body: "" }); await ready(s);
    await s.controller.accept(); expect(s.current().body).toBe(" continued text");
    await s.controller.undo(); expect(s.current().body).toBe("");
  });
  it("preserves the frozen caret and contextual prompt through refinement and Try again", async () => {
    const s = setup("continue", { caret: 7 }); await ready(s);
    const envelope = s.controller.snapshot().envelope;
    s.controller.refine("Shorter"); await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    const refined = s.generate.mock.calls[1][1];
    expect(refined).toContain('"before":"Before "');
    expect(refined).toContain('"after":"rough passage. After."');
    expect(refined).toContain('"instruction":"Shorter"');
    s.controller.tryAgain(); await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    expect(s.generate.mock.calls[2][1]).toBe(refined);
    expect(s.controller.snapshot().envelope).toEqual(envelope);
  });
  it.each(["check", "accept", "completion"])("rejects unsaved body changes during %s with unchanged revision", async (phase) => {
    const s = setup("continue", { caret: 7, slow: phase === "completion" });
    if (phase === "completion") { s.controller.start(); await vi.waitFor(() => expect(s.generate).toHaveBeenCalledOnce()); }
    else await ready(s);
    s.change({ body: "Peer edit before " + initial().body });
    if (phase === "check") s.controller.check(s.current());
    else if (phase === "accept") await s.controller.accept();
    else s.answer.resolve(" new text");
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("stale"));
    expect(s.execute).not.toHaveBeenCalled();
  });
  it("stops, retries and discards a caret generation without applying partial output", async () => {
    const s = setup("continue", { caret: 7, slow: true });
    s.controller.start(); await vi.waitFor(() => expect(s.generate).toHaveBeenCalledOnce());
    s.controller.stop(); expect(s.controller.snapshot().status).toBe("failed");
    await s.controller.accept(); expect(s.execute).not.toHaveBeenCalled();
    s.answer.resolve(" new text"); s.controller.retry();
    await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    s.controller.discard(); await s.controller.accept();
    expect(s.controller.snapshot().status).toBe("discarded"); expect(s.execute).not.toHaveBeenCalled();
  });
  it("refuses a changed revision and refuses Undo after a later body edit", async () => {
    const s = setup("continue", { caret: 7 }); await ready(s);
    s.change({ revision: 8 }); await s.controller.accept();
    expect(s.controller.snapshot().status).toBe("stale"); expect(s.execute).not.toHaveBeenCalled();
    s.controller.retry(); await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
    await s.controller.accept(); s.change({ body: s.current().body + " later" }); await s.controller.undo();
    expect(s.execute).toHaveBeenCalledOnce(); expect(s.controller.snapshot().error).toContain("newer text");
  });
});


it("requires a recaptured caret to regenerate after its source body changes", async () => {
  const s = setup("continue", { caret: 7 }); await ready(s);
  s.change({ body: "New body" }); s.controller.check(s.current());
  s.controller.retry(null);
  await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("stale"));
  expect(s.generate).toHaveBeenCalledOnce();
  s.controller.retry({ field: "body", start: 8, end: 8, text: "" });
  await vi.waitFor(() => expect(s.controller.snapshot().status).toBe("ready"));
  expect(s.generate.mock.calls[1][1]).toContain('"before":"New body","after":""');
  expect(s.controller.snapshot().envelope).toMatchObject({ start: 8, end: 8 });
});
