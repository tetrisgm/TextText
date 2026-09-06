import React from "react";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as Y from "yjs";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { applyDocumentBaseline, applyDocumentMutation, documentSnapshotFromYDoc } from "@/lib/collab/document";
import * as envelopes from "@/lib/ai/selection-envelope";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createInlinePreview } from "../inline-preview";
import { InlineSelectionPreview } from "../InlineSelectionPreview";
import { AssistantRailShell } from "../AssistantRailShell";
import { mergeAssistantConversationSyncPayloads } from "@/lib/ai/assistant-conversation-sync";
import { DEFAULT_CONTEXT_CHOICE } from "@/lib/ai/context-choice";

// Boundary tests use production controllers, validators, merge and SSR rendering.
// They do not claim native Safari interaction coverage.
describe("round9 review regressions", () => {
  it("preserves both halves of a word through caret insertion and Undo", async () => {
    let item = { revision: 7, title: "Draft", excerpt: "", body: "Hello" };
    const controller = createInlinePreview({ itemId: "item", action: "continue",
      selection: { field: "body", start: 2, end: 2, text: "" } }, {
      read: async () => item, active: () => true, persist: vi.fn(),
      generate: async envelope => ({ text: "NEW", selectionEnvelope: envelope }),
      execute: async edit => { item = { ...item, revision: item.revision + 1,
        body: item.body.slice(0, edit.start) + edit.replacement_text + item.body.slice(edit.end) }; },
    });
    controller.start(); await vi.waitFor(() => expect(controller.snapshot().status).toBe("ready"));
    await controller.accept(); expect(item.body).toBe("HeNEWllo");
    await controller.undo(); expect(item.body).toBe("Hello");
  });

  it("requires a fresh preview after editor Undo/Redo even when the body returns to the same bytes", async () => {
    let item = { revision: 7, title: "Draft", excerpt: "", body: "Hello" };
    const execute = vi.fn();
    const caret = { field: "body" as const, start: 2, end: 2, text: "" };
    const controller = createInlinePreview({ itemId: "item", action: "continue", selection: caret }, {
      read: async () => item, active: () => true, persist: vi.fn(), execute,
      generate: async envelope => ({ text: "NEW", selectionEnvelope: envelope }),
    });
    controller.start(); await vi.waitFor(() => expect(controller.snapshot().status).toBe("ready"));
    item = { ...item, body: "Hel", revision: 8 }; controller.check(item);
    item = { ...item, body: "Hello", revision: 9 }; controller.check(item);
    await controller.accept(); expect(execute).not.toHaveBeenCalled();
    expect(controller.snapshot().status).toBe("stale");
    controller.retry(caret); await vi.waitFor(() => expect(controller.snapshot().status).toBe("ready"));
    expect(controller.snapshot().envelope?.revision).toBe(9);
  });

  it("R1 fences an unsaved peer edit at the mutation boundary of caret Accept", async () => {
    const source = { revision: 7, title: "Draft", excerpt: "", body: "Hello world" };
    let live = { ...source };
    const controller = createInlinePreview({ itemId: "item", action: "continue",
      selection: { field: "body", start: 6, end: 6, text: "" } }, {
      read: async () => source, active: () => true, persist: vi.fn(),
      generate: async envelope => ({ text: "bright ", selectionEnvelope: envelope }),
      execute: async edit => {
        // A relayed Yjs update arrives after the local read, before the server
        // loads the live document. Its published revision is still 7.
        live = { ...source, body: "Peer says: Hello world" };
        const doc = new Y.Doc();
        const snapshot = emptyDocumentSnapshot(); snapshot.content.body = live.body;
        applyDocumentBaseline(doc, snapshot, "round9");
        // Execute the production commit function with its I/O injected. The
        // real Yjs mutation, selection guard and append version fence all run.
        const file = readFileSync("src/lib/collab.ts", "utf8");
        const start = file.indexOf("export async function applyLiveDocumentMutation(");
        const end = file.indexOf("\n/**", start);
        const code = ts.transpileModule(file.slice(start, end).replace("export async", "async"), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
        }).outputText;
        const append = vi.fn(async () => ({ seq: 2 }));
        const deps = { db: {}, Y, Buffer, applyDocumentMutation, documentSnapshotFromYDoc,
          loadCurrentCollabDocument: async () => ({ document: doc, epoch: 1, mutationVersion: 2 }),
          getPostStoreContext: async () => ({ post: { revision: 7 } }),
          validateSelectionEditEnvelope: envelopes.validateSelectionEditEnvelope,
          validateSelectionEnvelope: envelopes.validateSelectionEnvelope,
          assertSelectionMatches: envelopes.assertSelectionMatches,
          SELECTION_STALE_ERROR: envelopes.SELECTION_STALE_ERROR,
          appendCollabUpdate: append, agentTextChanges: () => [], latestCollabSeq: async () => 2,
        };
        const commit = new Function(...Object.keys(deps), code + ";return applyLiveDocumentMutation;")(...Object.values(deps));
        const result = await commit("item", { textRange: { field: "body", start: edit.start, end: edit.end,
          expectedText: edit.expected_text, replacementText: edit.replacement_text,
          selectionEnvelope: edit.selection_envelope } }, { actionName: "mcp.update_item" });
        live.body = result.snapshot.content.body;
      },
    });
    controller.start();
    await vi.waitFor(() => expect(controller.snapshot().status).toBe("ready"));
    await controller.accept();
    expect(live.body).toBe("Peer says: Hello world");
    expect(controller.snapshot().status).toBe("stale");
  });

  it("R1 fences a peer edit between the Undo read and the live range mutation", async () => {
    let local = { revision: 7, title: "Draft", excerpt: "", body: "Hello" };
    let liveBody = local.body;
    let writes = 0;
    const controller = createInlinePreview({ itemId: "item", action: "continue",
      selection: { field: "body", start: 0, end: 0, text: "" } }, {
      read: async () => local, active: () => true, persist: vi.fn(),
      generate: async envelope => ({ text: "new ", selectionEnvelope: envelope }),
      execute: async edit => {
        if (++writes === 2) liveBody = "new peer " + liveBody;
        if (edit.selection_envelope) await envelopes.validateSelectionEditEnvelope(
          edit.selection_envelope, "item", { ...local, body: liveBody }, { ...edit, text: edit.expected_text });
        const doc = new Y.Doc(); const snapshot = emptyDocumentSnapshot(); snapshot.content.body = liveBody;
        applyDocumentBaseline(doc, snapshot, "round9-undo");
        try {
          applyDocumentMutation(doc, { textRange: { field: "body", start: edit.start, end: edit.end,
            expectedText: edit.expected_text, replacementText: edit.replacement_text } });
          liveBody = documentSnapshotFromYDoc(doc).content.body;
          local = { ...local, revision: local.revision + 1, body: liveBody };
        } finally { doc.destroy(); }
      },
    });
    controller.start(); await vi.waitFor(() => expect(controller.snapshot().status).toBe("ready"));
    await controller.accept(); expect(local.body).toBe("new Hello");
    await controller.undo();
    expect(liveBody).toBe("new peer new Hello");
    expect(controller.snapshot().status).toBe("applied");
  });

  it("R2 keeps the displayed generation's context note truthful after changing next-generation context", async () => {
    const generate = vi.fn(async envelope => ({ text: "Result using the full item", selectionEnvelope: envelope }));
    const controller = createInlinePreview({ itemId: "item", action: "rewrite",
      selection: { field: "body", start: 0, end: 5, text: "Hello" } }, {
      read: async () => ({ revision: 7, title: "Draft", excerpt: "", body: "Hello private context" }),
      active: () => true, persist: vi.fn(), execute: vi.fn(), generate,
    });
    controller.start();
    await vi.waitFor(() => expect(controller.snapshot().status).toBe("ready"));
    controller.setIncludeItem(false);
    const html = renderToStaticMarkup(<InlineSelectionPreview controller={controller}
      surface={{} as never} readSelection={() => null} onClose={() => {}} />);
    expect(generate).toHaveBeenCalledOnce();
    expect(html).toContain("Result using the full item");
    expect(html).not.toContain("Context: this passage only");
  });

  it("R3 preserves a context change when another offline device only pins the thread", () => {
    const base = { id: "chat", contextKey: "root", title: "Original", pinned: false,
      createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
      metadataUpdatedAt: "2026-09-01T00:00:00.000Z", messages: [], contextChoice: DEFAULT_CONTEXT_CHOICE };
    const choice = { ...DEFAULT_CONTEXT_CHOICE, includeItem: false,
      itemIds: ["00000000-0000-4000-8000-000000000001"] };
    const a = { ...base, contextChoice: choice, metadataUpdatedAt: "2026-09-01T00:01:00.000Z" };
    const b = { ...base, pinned: true, metadataUpdatedAt: "2026-09-01T00:02:00.000Z" };
    const merged = mergeAssistantConversationSyncPayloads([a], [b]);
    expect(merged[0].pinned).toBe(true);
    expect(merged[0].contextChoice).toEqual(choice);
  });

  it.each([
    ["Context row", {}, 'aria-label="Context for the next turn"'],
    ["attachment row", { attachments: [{ id: "file", name: "Research.pdf", size: 123, type: "application/pdf" }] }, 'aria-label="Added context"'],
    ["Stop control", { submitting: true }, 'aria-label="Stop assistant"'],
    ["approval count", { pendingCount: 1 }, "1 approval"],
    ["sync retry", { historySyncStatus: "offline", onRetryHistorySync: () => {} }, "Retry sync"],
  ] as const)("R4 paints the loaded rail's %s in the static rail", (_name, props, expected) => {
    const html = renderToStaticMarkup(<AssistantRailShell state="pinned" composerValue=""
      context={{ kind: "item", label: "Draft" }} onComposerChange={() => {}}
      onStateChange={() => {}} onSubmit={() => {}} {...props as object} />);
    expect(html).toContain(expected);
  });
});
