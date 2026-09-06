import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSelectionEnvelope, validateSelectionEnvelope, validateSelectionEditEnvelope, validateSelectionSource, SELECTION_STALE_ERROR } from "@/lib/ai/selection-envelope";
import { DEFAULT_CONTEXT_CHOICE, cleanAssistantContextResolutions, unavailableContextWarning } from "@/lib/ai/context-choice";
import { mergeAssistantConversationSyncPayloads } from "@/lib/ai/assistant-conversation-sync";
import { cloudAssistantTurn } from "@/lib/ai/cloud-client";
import { createInlinePreview } from "../inline-preview";
import { AssistantConversation } from "../AssistantConversation";

const id = "00000000-0000-4000-8000-000000000001";
const item = { revision: 7, title: "Draft", excerpt: "", body: "Hello" };
const caret = { field: "body" as const, start: 0, end: 0, text: "" };
afterEach(() => vi.unstubAllGlobals());

describe("round9 implementation boundaries", () => {
  it("binds the entire caret body and rejects stripping or tampering with its hash", async () => {
    const envelope = (await createSelectionEnvelope(id, item, caret))!;
    await expect(validateSelectionEditEnvelope(envelope, id, { ...item, body: "Peer Hello" }, caret)).rejects.toThrow(SELECTION_STALE_ERROR);
    await expect(validateSelectionEnvelope({ ...envelope, sourceHash: "0".repeat(64) })).rejects.toThrow();
    const { sourceHash, ...stripped } = envelope;
    expect(sourceHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(validateSelectionEnvelope(stripped)).rejects.toThrow();
    expect(JSON.stringify(envelope)).not.toContain(item.body);
  });

  it.each([false, true])("guards Undo of a suggestion longer than the selection budget (peer edit=%s)", async (peer) => {
    let current = { ...item };
    let writes = 0;
    const text = "new ".repeat(1100);
    const controller = createInlinePreview({ itemId: id, action: "continue", selection: caret }, {
      read: async () => current, persist: vi.fn(), active: () => true,
      generate: async (envelope) => ({ text, selectionEnvelope: envelope }),
      execute: async (edit) => {
        if (++writes === 2 && peer) current = { ...current, body: "new peer " + current.body };
        if (edit.selection_envelope) await validateSelectionEditEnvelope(edit.selection_envelope, id, current, { ...edit, text: edit.expected_text });
        if (edit.source_precondition) await validateSelectionSource(await validateSelectionEnvelope(edit.source_precondition), id, current);
        current = { ...current, revision: current.revision + 1, body: current.body.slice(0, edit.start) + edit.replacement_text + current.body.slice(edit.end) };
      },
    });
    controller.start(); await vi.waitFor(() => expect(controller.snapshot().status).toBe("ready"));
    await controller.accept(); await controller.undo();
    expect(current.body).toBe(peer ? "new peer " + text + item.body : item.body);
    expect(controller.snapshot().status).toBe(peer ? "applied" : "undone");
    expect(controller.snapshot().uncertain).not.toBe(true);
  });

  it("keeps in-flight context provenance and uses the next setting on regeneration", async () => {
    let finish!: (value: { text: string; selectionEnvelope: Awaited<ReturnType<typeof createSelectionEnvelope>> }) => void;
    const generate = vi.fn<Parameters<typeof createInlinePreview>[1]["generate"]>(() => new Promise((resolve) => { finish = resolve; }));
    const controller = createInlinePreview({ itemId: id, action: "continue", selection: caret }, {
      read: async () => item, persist: vi.fn(), active: () => true, execute: vi.fn(), generate,
    });
    controller.start(); await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    controller.setIncludeItem(false);
    expect(controller.snapshot()).toMatchObject({ generationIncludeItem: true, includeItem: false });
    finish({ text: "new ", selectionEnvelope: controller.snapshot().envelope });
    await vi.waitFor(() => expect(controller.snapshot().status).toBe("ready"));
    expect(controller.snapshot().generationIncludeItem).toBe(true);
    controller.tryAgain(); await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(generate.mock.calls[1][4]).toBe(false);
    expect(controller.snapshot().generationIncludeItem).toBe(false);
    controller.dispose();
  });

  const base = { id: "chat", contextKey: "root", title: "Original", pinned: false, messages: [],
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", metadataUpdatedAt: "2026-09-01T00:00:00.000Z" };
  it("allows an explicit reset to default context independently of a later pin", () => {
    const a = { ...base, contextChoice: DEFAULT_CONTEXT_CHOICE, contextUpdatedAt: "2026-09-01T00:02:00.000Z" };
    const b = { ...base, pinned: true, contextChoice: { ...DEFAULT_CONTEXT_CHOICE, includeItem: false },
      contextUpdatedAt: "2026-09-01T00:01:00.000Z", metadataUpdatedAt: "2026-09-01T00:03:00.000Z" };
    const merged = mergeAssistantConversationSyncPayloads([a], [b]);
    expect(merged[0]).toMatchObject({ pinned: true, contextChoice: DEFAULT_CONTEXT_CHOICE, contextUpdatedAt: a.contextUpdatedAt });
    expect(merged).toEqual(mergeAssistantConversationSyncPayloads([b], [a]));
    expect(merged).toEqual(mergeAssistantConversationSyncPayloads(merged, merged));
  });

  it("resolves simultaneous context edits deterministically", () => {
    const a = { ...base, contextChoice: { ...DEFAULT_CONTEXT_CHOICE, includeItem: false }, contextUpdatedAt: base.createdAt };
    const b = { ...base, contextChoice: { ...DEFAULT_CONTEXT_CHOICE, itemIds: [id] }, contextUpdatedAt: base.createdAt };
    expect(mergeAssistantConversationSyncPayloads([a], [b])).toEqual(mergeAssistantConversationSyncPayloads([b], [a]));
  });

  it.each([false, true])("carries per-id context outcomes to the client (stream=%s)", async (stream) => {
    const contextResolutions = [{ id, status: "unavailable" }];
    const answer = { type: "complete", provider: "OpenAI", model: "test", text: "Reply", contextResolutions };
    vi.stubGlobal("fetch", vi.fn(async () => stream ? new Response([
      JSON.stringify({ type: "start", provider: "OpenAI", model: "test", contextResolutions }), JSON.stringify(answer), "",
    ].join("\n")) : Response.json(answer)));
    const onEvent = vi.fn();
    const result = await cloudAssistantTurn("writer", "Summarize", { relatedItems: [{ id, origin: "person" }] }, { stream, onEvent });
    expect(result).toMatchObject({ contextResolutions });
    if (stream) expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "start", contextResolutions }));
  });

  it("withholds inaccessible titles and malformed outcomes from resolution notices", () => {
    const outcomes = cleanAssistantContextResolutions([{ id, status: "unavailable", title: "Secret" }, { id: "bad", status: "read" }, { id, status: "guessed" }]);
    expect(outcomes).toEqual([{ id, status: "unavailable" }]);
    expect(unavailableContextWarning(outcomes)).toBe("1 chosen context item is unavailable. The assistant could not use that source.");
  });

  it("keeps unavailable-context notices visible after completion without showing ordinary progress", () => {
    const html = renderToStaticMarkup(<AssistantConversation submitting={false} messages={[
      { id: "progress", role: "progress", text: "Transient progress" },
      { id: "warning", role: "progress", text: "Chosen context is unavailable.", contextWarning: true },
    ]} />);
    expect(html).toContain("Chosen context is unavailable.");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Transient progress");
  });
});
