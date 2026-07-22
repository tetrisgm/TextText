import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/workspace-tool-client", () => ({
  executeWorkspaceToolRequest: vi.fn(),
}));

import {
  assistantAttachmentAccept,
  buildNativeAssistantPrompt,
  formatAssistantSubmission,
} from "@/components/workspace/assistant/attachments";
import { createAssistantConfirmationController } from "@/components/workspace/assistant/confirmation";
import type { AssistantAttachment } from "@/components/workspace/assistant/AssistantSidebar";
import { createWorkspaceAgentTools } from "@/lib/ai/agent-tools";
import { isNativeModelAssetError, nativeAgent } from "@/lib/ai/native";
import { runNativeQuickAction } from "@/lib/ai/quick-actions";
import {
  fallbackForNativeAssetError,
  runUnavailableAssistantFallback,
} from "@/components/workspace/assistant/unavailable-fallback";
import { executeWorkspaceToolRequest } from "@/lib/ai/workspace-tool-client";
import {
  patchOpenWorkspaceItemDraft,
  readOpenWorkspaceItemDraft,
  registerOpenWorkspaceItemDraft,
} from "@/lib/ai/workspace-item-draft";
import type { WorkspacePoolPayload } from "@/lib/pool/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function attachment(file: File): AssistantAttachment {
  return {
    id: file.name,
    file,
    name: file.name,
    size: file.size,
    type: file.type,
  };
}

function pool(): WorkspacePoolPayload {
  return {
    version: 1,
    blogId: "blog-1",
    fetchedAt: "2026-07-14T12:00:00.000Z",
    blog: {
      handle: "local",
      name: "Local",
      author: "Writer",
      tagline: "",
      cardStyle: "cover",
      homeLayout: "grid",
    },
    folders: [
      { id: "blog", name: "Blog", path: "blog", mode: "blog", position: 0 },
    ],
    posts: [
      {
        id: "post-1",
        blogId: "blog-1",
        folderId: "blog",
        type: "article",
        slug: "draft",
        title: "Draft",
        status: "draft",
        pinned: false,
        createdAt: "2026-07-14T12:00:00.000Z",
        updatedAt: "2026-07-14T12:00:00.000Z",
      },
    ],
    counts: {},
  };
}

describe("native assistant submissions", () => {
  it("recognizes framework model-asset copy for defensive remapping", () => {
    expect(
      isNativeModelAssetError(
        new Error("Resource (Local Model Asset) unavailable error."),
      ),
    ).toBe(true);
    expect(isNativeModelAssetError(new Error("No folder at path ideas"))).toBe(
      false,
    );
  });

  it("turns a mid-flight asset failure into a calm assistant message", async () => {
    vi.stubGlobal("window", { writeNativeAI: { request: vi.fn() } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ enabled: false, provider: null })),
      ),
    );

    const retryNative = vi.fn(async () => {
      throw new Error("Resource (Local Model Asset) unavailable error.");
    });
    const onPreparing = vi.fn();
    const result = await fallbackForNativeAssetError({
      error: new Error("Resource (Local Model Asset) unavailable error."),
      prompt: "Summarize this",
      reprobe: async () => ({
        available: false,
        reason: "modelNotReady",
        ocr: false,
        imageUnderstanding: false,
      }),
      retryNative,
      retryDelaysMs: [0, 0],
      onPreparing,
    });

    expect(result).toMatchObject({
      kind: "fallback",
      message: {
        role: "assistant",
        text: "The Apple Intelligence model runs on this Mac. macOS is preparing it automatically, and Texttext will use it as soon as it is ready.",
      },
    });
    expect(retryNative).toHaveBeenCalledTimes(2);
    expect(onPreparing).toHaveBeenNthCalledWith(1, "downloading", 1, 2);
    expect(onPreparing).toHaveBeenNthCalledWith(2, "downloading", 2, 2);
    expect(result?.kind === "fallback" && result.message).toEqual({
      role: "assistant",
      text: "The Apple Intelligence model runs on this Mac. macOS is preparing it automatically, and Texttext will use it as soon as it is ready.",
    });
  });

  it("retries a preparing native model and returns the local result", async () => {
    const retryNative = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Resource (Local Model Asset) unavailable error."),
      )
      .mockResolvedValueOnce({ text: "Local answer", truncated: false });
    const onPreparing = vi.fn();

    await expect(
      fallbackForNativeAssetError({
        error: new Error("assets unavailable"),
        prompt: "Answer locally",
        reprobe: async () => ({
          available: true,
          ocr: true,
          imageUnderstanding: false,
        }),
        retryNative,
        retryDelaysMs: [0, 0, 0],
        onPreparing,
      }),
    ).resolves.toEqual({
      kind: "recovered",
      capabilities: {
        available: true,
        ocr: true,
        imageUnderstanding: false,
      },
      value: { text: "Local answer", truncated: false },
    });
    expect(retryNative).toHaveBeenCalledTimes(2);
    expect(onPreparing).toHaveBeenNthCalledWith(1, "preparing", 1, 3);
  });

  it("does not turn an agent failure into a model download state", async () => {
    vi.stubGlobal("window", { writeNativeAI: { request: vi.fn() } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ enabled: false, provider: null })),
      ),
    );
    const capabilities = {
      available: true,
      ocr: true,
      imageUnderstanding: false,
    };

    await expect(
      fallbackForNativeAssetError({
        error: new Error("Resource (Local Model Asset) unavailable error."),
        prompt: "Rename this",
        reprobe: async () => capabilities,
        retryNative: async () => {
          throw new Error("Resource (Local Model Asset) unavailable error.");
        },
        retryDelaysMs: [0],
      }),
    ).resolves.toEqual({
      kind: "fallback",
      capabilities,
      message: {
        role: "assistant",
        text: "The on-device Assistant could not complete this request. Try again.",
      },
    });
  });

  it("does not retry a genuinely ineligible Mac", async () => {
    vi.stubGlobal("window", { writeNativeAI: { request: vi.fn() } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ enabled: false, provider: null })),
      ),
    );
    const retryNative = vi.fn();

    const result = await fallbackForNativeAssetError({
      error: new Error("Local Model Asset unavailable"),
      prompt: "Answer locally",
      reprobe: async () => ({
        available: false,
        reason: "appleIntelligenceNotEnabled",
        ocr: true,
        imageUnderstanding: false,
      }),
      retryNative,
      retryDelaysMs: [0, 0, 0],
    });

    expect(retryNative).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: "fallback",
      message: {
        role: "assistant",
        text: "Apple Intelligence is turned off. Enable it in System Settings, then try again.",
      },
    });
  });

  it("marks a cloud fallback answer with its off-device provider", async () => {
    vi.stubGlobal("window", { writeNativeAI: { request: vi.fn() } });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ enabled: true, provider: "Anthropic" }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ text: "Cloud answer", provider: "Anthropic" }),
        ),
      );
    vi.stubGlobal("fetch", fetch);

    await expect(
      runUnavailableAssistantFallback({
        capabilities: {
          available: false,
          reason: "modelNotReady",
          ocr: false,
          imageUnderstanding: false,
        },
        prompt: "Answer this",
      }),
    ).resolves.toEqual({
      role: "assistant",
      text: "Cloud answer",
      provider: "Anthropic",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("includes local text attachments in the native agent prompt", async () => {
    const file = new File(["Local-only source text"], "source.md", {
      type: "text/markdown",
    });
    const result = await buildNativeAssistantPrompt("Summarize this", [
      attachment(file),
    ]);

    expect(result.displayText).toBe("Summarize this\n\nAttached: source.md");
    expect(result.prompt).toContain("[Attachment: source.md]");
    expect(result.prompt).toContain("Local-only source text");
  });

  it("uses the native OCR callback for image attachments", async () => {
    vi.stubGlobal("window", {
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    });
    const ocr = vi.fn(async () => ({ text: "Words from image" }));
    const file = new File(["image bytes"], "scan.png", { type: "image/png" });
    const result = await buildNativeAssistantPrompt("", [attachment(file)], ocr);

    expect(formatAssistantSubmission("", [attachment(file)])).toBe(
      "Review attached: scan.png",
    );
    expect(ocr).toHaveBeenCalledOnce();
    expect(result.prompt).toContain("Words from image");
  });

  it("offers image attachments only when native OCR is available", () => {
    expect(assistantAttachmentAccept(null)).toBe(".txt,.md,.markdown");
    expect(
      assistantAttachmentAccept({
        available: true,
        ocr: true,
        imageUnderstanding: false,
      }),
    ).toBe("image/*,.txt,.md,.markdown");
  });

  it("dispatches through the native agent bridge without a network request", async () => {
    const request = vi.fn(async () => ({ text: "Done", truncated: false }));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { writeNativeAI: { request } });

    await expect(
      nativeAgent("Create a draft", {
        context: "Selected item",
        tools: ["create_item"],
      }),
    ).resolves.toEqual({ text: "Done", truncated: false });
    expect(request).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        prompt: "Create a draft",
        context: "Selected item",
        tools: ["create_item"],
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("creates an applyable title preview through the on-device bridge", async () => {
    const request = vi.fn(async (op: string) => {
      expect(op).toBe("title");
      return { title: "A clearer title", truncated: false };
    });
    vi.stubGlobal("window", { writeNativeAI: { request } });

    await expect(
      runNativeQuickAction("title", {
        title: "Draft",
        excerpt: "",
        body: "A useful local document.",
      }),
    ).resolves.toEqual({
      kind: "proposal",
      field: "title",
      label: "Suggested title",
      before: "Draft",
      after: "A clearer title",
      source: "Draft",
      result: "A clearer title",
      range: { start: 0, end: 5 },
      scope: "field",
      canApply: true,
      note: undefined,
    });
  });

  it("summarizes only the current selection", async () => {
    const request = vi.fn(async (op: string, payload: unknown) => {
      expect(op).toBe("summarize");
      expect(payload).toEqual({ text: "selected words" });
      return { summary: "Selection summary", truncated: false };
    });
    vi.stubGlobal("window", { writeNativeAI: { request } });
    const body = "Before selected words after";
    const start = body.indexOf("selected words");

    await expect(
      runNativeQuickAction("summarize", {
        title: "Draft",
        excerpt: "",
        body,
        selection: {
          field: "body",
          start,
          end: start + "selected words".length,
          text: "selected words",
        },
      }),
    ).resolves.toEqual({ kind: "response", text: "Selection summary" });
  });

  it("proposes canonical tags merged with existing metadata", async () => {
    const request = vi.fn(async (op: string) => {
      expect(op).toBe("tags");
      return { tags: ["#Design", "Writing", "design"], truncated: false };
    });
    vi.stubGlobal("window", { writeNativeAI: { request } });

    await expect(
      runNativeQuickAction("tags", {
        title: "Draft",
        excerpt: "A design note",
        body: "Useful text.",
        tags: ["notes"],
      }),
    ).resolves.toEqual({
      kind: "tags-proposal",
      label: "Suggested tags",
      beforeTags: ["notes"],
      afterTags: ["notes", "design", "writing"],
      addedTags: ["design", "writing"],
      canApply: true,
      note: undefined,
    });
  });

  it("creates a precise range proposal when rewriting a selection", async () => {
    const request = vi.fn(async (op: string, payload: unknown) => {
      expect(op).toBe("rewrite");
      expect(payload).toMatchObject({ text: "rough phrase" });
      return { text: "clear sentence", truncated: false };
    });
    vi.stubGlobal("window", { writeNativeAI: { request } });
    const body = "Keep this rough phrase and the ending.";
    const start = body.indexOf("rough phrase");

    await expect(
      runNativeQuickAction("rewrite", {
        title: "Draft",
        excerpt: "",
        body,
        selection: {
          field: "body",
          start,
          end: start + "rough phrase".length,
          text: "rough phrase",
        },
      }),
    ).resolves.toMatchObject({
      kind: "proposal",
      field: "body",
      label: "Rewritten selection",
      before: "rough phrase",
      after: "clear sentence",
      source: body,
      result: "Keep this clear sentence and the ending.",
      range: { start, end: start + "rough phrase".length },
      scope: "selection",
      canApply: true,
    });
  });

  it("never offers to replace a body with a truncated rewrite", async () => {
    const request = vi.fn(async () => ({
      text: "Partial rewrite",
      truncated: true,
    }));
    vi.stubGlobal("window", { writeNativeAI: { request } });

    const result = await runNativeQuickAction("rewrite", {
      title: "Draft",
      excerpt: "",
      body: "A long document.",
    });

    expect(result).toMatchObject({
      kind: "proposal",
      field: "body",
      after: "Partial rewrite",
      canApply: false,
    });
  });
});

describe("assistant local-first item edits", () => {
  it("reads and patches the open editor draft synchronously", () => {
    let current = { title: "Draft", excerpt: "", body: "Local body" };
    const unregister = registerOpenWorkspaceItemDraft("post-1", {
      read: () => current,
      apply: (patch) => {
        current = { ...current, ...patch };
      },
    });

    expect(readOpenWorkspaceItemDraft("post-1")?.body).toBe("Local body");
    expect(
      patchOpenWorkspaceItemDraft("post-1", { title: "Changed now" }),
    ).toBe(true);
    expect(readOpenWorkspaceItemDraft("post-1")?.title).toBe("Changed now");
    unregister();
    expect(readOpenWorkspaceItemDraft("post-1")).toBeNull();
  });

  it("routes agent updates through the live draft command when provided", async () => {
    const applyItemPatch = vi.fn(async () => ({ synced: true }));
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: pool,
      readItemText: async () => ({
        title: "Draft",
        excerpt: "Old excerpt",
        body: "Local body",
      }),
      applyItemPatch,
    });

    await expect(
      tools.executor("update_item", {
        id: "post-1",
        title: "Local title",
        excerpt: "Local excerpt",
      }),
    ).resolves.toMatchObject({ ok: true, id: "post-1", title: "Local title" });
    expect(applyItemPatch).toHaveBeenCalledWith("post-1", {
      title: "Local title",
      excerpt: "Local excerpt",
      body: undefined,
    });
  });

  it("persists tag metadata through the stable workspace command", async () => {
    const workspace = pool();
    workspace.posts[0]!.tags = ["notes"];
    vi.mocked(executeWorkspaceToolRequest).mockResolvedValueOnce({
      item: {
        id: "post-1",
        title: "Draft",
        tags: ["notes", "design"],
      },
    });
    const refreshPool = vi.fn(async () => undefined);
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: () => workspace,
      readItemText: async () => ({
        title: "Draft",
        excerpt: "",
        body: "Local body",
        tags: ["notes"],
      }),
      refreshPool,
    });

    await expect(
      tools.executor("update_item", {
        id: "post-1",
        tags: ["#Notes", "Design", "design"],
      }),
    ).resolves.toMatchObject({ ok: true, id: "post-1" });
    expect(executeWorkspaceToolRequest).toHaveBeenCalledWith(
      "local",
      "update_item",
      { id: "post-1", tags: ["notes", "design"] },
    );
    expect(refreshPool).toHaveBeenCalledOnce();
  });
});

describe("assistant destructive confirmation", () => {
  it("resolves only through the in-app confirmation controller", async () => {
    const changes: Array<string | null> = [];
    const controller = createAssistantConfirmationController((request) =>
      changes.push(request?.description ?? null),
    );

    const confirmed = controller.request('Publish "Draft"?');
    controller.confirm();
    const cancelled = controller.request('Delete "Draft"?');
    controller.cancel();

    await expect(confirmed).resolves.toBe(true);
    await expect(cancelled).resolves.toBe(false);
    expect(changes).toEqual([
      'Publish "Draft"?',
      null,
      'Delete "Draft"?',
      null,
    ]);
  });

  it("fails closed when the tool executor has no confirmation UI", async () => {
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: pool,
    });

    await expect(
      tools.executor("delete_item", { id: "post-1" }),
    ).resolves.toEqual({ ok: false, cancelled: true });
    expect(pool().posts[0]?.status).toBe("draft");
  });

  it("fails closed when a destructive confirmation has no description", async () => {
    const changes: Array<string | null> = [];
    const controller = createAssistantConfirmationController((request) =>
      changes.push(request?.description ?? null),
    );

    await expect(controller.request("   ")).resolves.toBe(false);
    expect(changes).toEqual([]);
  });
});
