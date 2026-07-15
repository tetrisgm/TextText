import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/editor/actions", () => ({
  createWorkspacePostAction: vi.fn(),
  deleteEditablePostAction: vi.fn(),
  movePostToFolderAction: vi.fn(),
  saveEditablePostAction: vi.fn(),
  setEditablePostStatusAction: vi.fn(),
}));

import {
  buildNativeAssistantPrompt,
  formatAssistantSubmission,
} from "@/components/workspace/assistant/attachments";
import { createAssistantConfirmationController } from "@/components/workspace/assistant/confirmation";
import type { AssistantAttachment } from "@/components/workspace/assistant/AssistantSidebar";
import { createWorkspaceAgentTools } from "@/lib/ai/agent-tools";
import { nativeAgent } from "@/lib/ai/native";
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
});
