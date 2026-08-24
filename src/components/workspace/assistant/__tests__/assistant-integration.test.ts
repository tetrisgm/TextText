import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/workspace-tool-client", () => ({
  executeWorkspaceToolRequest: vi.fn(),
}));

import {
  assistantAttachmentAccept,
  buildCloudAssistantAttachments,
  buildCloudAssistantPrompt,
  buildNativeAssistantPrompt,
  formatAssistantSubmission,
} from "@/components/workspace/assistant/attachments";
import { createAssistantConfirmationController } from "@/components/workspace/assistant/confirmation";
import type { AssistantAttachment } from "@/components/workspace/assistant/AssistantSidebar";
import { createWorkspaceAgentTools } from "@/lib/ai/agent-tools";
import { executeWorkspaceToolRequest } from "@/lib/ai/workspace-tool-client";
import {
  patchOpenWorkspaceItemDraft,
  readOpenWorkspaceItemDraft,
  registerOpenWorkspaceItemDraft,
} from "@/lib/ai/workspace-item-draft";
import type { WorkspacePoolPayload } from "@/lib/pool/types";

afterEach(() => {
  vi.clearAllMocks();
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
    templates: [],
  };
}

describe("assistant attachments", () => {
  it("includes local text attachments in the provider prompt", async () => {
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

  it("uses native OCR for image attachments", async () => {
    vi.stubGlobal("window", {
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    });
    const ocr = vi.fn(async () => ({ text: "Words from image" }));
    const file = new File(["image bytes"], "scan.png", { type: "image/png" });
    const result = await buildNativeAssistantPrompt(
      "",
      [attachment(file)],
      ocr,
    );

    expect(formatAssistantSubmission("", [attachment(file)])).toBe(
      "Review attached: scan.png",
    );
    expect(ocr).toHaveBeenCalledOnce();
    expect(result.prompt).toContain("Words from image");
  });

  it("includes bounded text attachments for cloud providers", async () => {
    const file = new File(["Cloud-safe source text"], "source.txt", {
      type: "text/plain",
    });
    const result = await buildCloudAssistantPrompt("Summarize this", [
      attachment(file),
    ]);

    expect(result).toContain("[Attachment: source.txt]");
    expect(result).toContain("Cloud-safe source text");
  });

  it("passes image attachments to the hosted provider as bounded data URLs", async () => {
    const file = new File(["image bytes"], "scan.png", { type: "image/png" });
    vi.stubGlobal("window", {
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    });
    await expect(
      buildCloudAssistantPrompt("Review this", [attachment(file)]),
    ).resolves.toContain("[Image attachment: scan.png]");
    await expect(
      buildCloudAssistantAttachments([attachment(file)]),
    ).resolves.toEqual([
      {
        name: "scan.png",
        mediaType: "image/png",
        dataUrl: "data:image/png;base64,aW1hZ2UgYnl0ZXM=",
      },
    ]);
  });

  it("passes a bounded PDF to the hosted provider as a file part", async () => {
    const file = new File(["pdf bytes"], "research.pdf", {
      type: "application/pdf",
    });
    vi.stubGlobal("window", {
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    });

    await expect(
      buildCloudAssistantPrompt("Review this", [attachment(file)]),
    ).resolves.toContain("[PDF attachment: research.pdf]");
    await expect(
      buildCloudAssistantAttachments([attachment(file)]),
    ).resolves.toEqual([
      {
        name: "research.pdf",
        mediaType: "application/pdf",
        dataUrl: "data:application/pdf;base64,cGRmIGJ5dGVz",
      },
    ]);
  });

  it("reads structured text formats without a binary parser", async () => {
    const file = new File(["name,status\nDraft,ready"], "items.csv", {
      type: "text/csv",
    });

    await expect(
      buildCloudAssistantPrompt("Summarize", [attachment(file)]),
    ).resolves.toContain("name,status\nDraft,ready");
  });

  it("offers Office documents to both native and hosted assistants", () => {
    expect(assistantAttachmentAccept(null)).toContain(".docx");
    expect(assistantAttachmentAccept({ vision: true })).toContain(".pptx");
    expect(assistantAttachmentAccept({ ocr: true })).toContain(".xlsx");
  });

  it("offers image attachments when native OCR or hosted vision is available", () => {
    expect(assistantAttachmentAccept(null)).toContain(".csv");
    expect(
      assistantAttachmentAccept({
        ocr: true,
      }),
    ).toContain("image/*");
    expect(assistantAttachmentAccept({ vision: true })).toContain(".pdf");
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
    expect(applyItemPatch).toHaveBeenCalledWith(
      "post-1",
      {
        title: "Local title",
        excerpt: "Local excerpt",
        body: undefined,
        tags: undefined,
      },
      {},
      undefined,
    );
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

  it("fails closed without a confirmation UI", async () => {
    const tools = createWorkspaceAgentTools({
      handle: "local",
      getPool: pool,
    });

    await expect(
      tools.executor("delete_item", { id: "post-1" }),
    ).resolves.toEqual({ ok: false, cancelled: true });
  });

  it("fails closed without a confirmation description", async () => {
    const changes: Array<string | null> = [];
    const controller = createAssistantConfirmationController((request) =>
      changes.push(request?.description ?? null),
    );

    await expect(controller.request("   ")).resolves.toBe(false);
    expect(changes).toEqual([]);
  });
});
