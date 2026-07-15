"use client";

import {
  nativeExcerpt,
  nativeRewrite,
  nativeSummarize,
  nativeTags,
  nativeTitle,
} from "@/lib/ai/native";
import type { WorkspaceItemTextSnapshot } from "@/lib/ai/workspace-item-draft";

export const NATIVE_QUICK_ACTIONS = [
  { id: "summarize", label: "Summarize" },
  { id: "rewrite", label: "Rewrite" },
  { id: "title", label: "Title" },
  { id: "tags", label: "Tags" },
  { id: "excerpt", label: "Excerpt" },
] as const;

export type NativeQuickActionId = (typeof NATIVE_QUICK_ACTIONS)[number]["id"];
export type NativeQuickActionField = "title" | "excerpt" | "body";

export type NativeQuickActionResult =
  | {
      kind: "response";
      text: string;
    }
  | {
      kind: "proposal";
      field: NativeQuickActionField;
      label: string;
      before: string;
      after: string;
      canApply: boolean;
      note?: string;
    };

function sourceText(item: WorkspaceItemTextSnapshot): string {
  return [item.title, item.excerpt, item.body]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n\n");
}

function requireSource(item: WorkspaceItemTextSnapshot): string {
  const source = sourceText(item);
  if (!source) throw new Error("Add some text first.");
  return source;
}

export async function runNativeQuickAction(
  action: NativeQuickActionId,
  item: WorkspaceItemTextSnapshot,
): Promise<NativeQuickActionResult> {
  const source = requireSource(item);

  switch (action) {
    case "summarize": {
      const result = await nativeSummarize(source);
      return { kind: "response", text: result.summary.trim() };
    }

    case "tags": {
      const result = await nativeTags(source, 5);
      const tags = result.tags.map((tag) => tag.trim()).filter(Boolean);
      return {
        kind: "response",
        text: tags.length > 0 ? tags.join(", ") : "No useful tags found.",
      };
    }

    case "title": {
      const result = await nativeTitle(source);
      return {
        kind: "proposal",
        field: "title",
        label: "Suggested title",
        before: item.title,
        after: result.title.trim(),
        canApply: Boolean(result.title.trim()),
      };
    }

    case "excerpt": {
      const result = await nativeExcerpt(source);
      return {
        kind: "proposal",
        field: "excerpt",
        label: "Suggested excerpt",
        before: item.excerpt,
        after: result.excerpt.trim(),
        canApply: Boolean(result.excerpt.trim()),
      };
    }

    case "rewrite": {
      if (!item.body.trim()) throw new Error("Add body text before rewriting.");
      const result = await nativeRewrite(
        item.body,
        "Clear and concise. Preserve the meaning and Markdown structure.",
      );
      const rewritten = result.text.trim();
      return {
        kind: "proposal",
        field: "body",
        label: "Rewritten body",
        before: item.body,
        after: rewritten,
        canApply: Boolean(rewritten) && !result.truncated,
        note: result.truncated
          ? "The document was too long to rewrite safely. The preview was not applied."
          : undefined,
      };
    }
  }
}
