"use client";

import {
  nativeExcerpt,
  nativeRewrite,
  nativeSummarize,
  nativeTags,
  nativeTitle,
} from "@/lib/ai/native";
import {
  createWorkspaceItemTextEdit,
  resolveWorkspaceItemTextSelection,
  type WorkspaceItemTextEdit,
  type WorkspaceItemTextField,
  type WorkspaceItemTextSnapshot,
} from "@/lib/ai/workspace-item-draft";

export const NATIVE_QUICK_ACTIONS = [
  {
    id: "summarize",
    label: "Summarize",
    description: "Summarize the selection or current item on this Mac",
  },
  {
    id: "rewrite",
    label: "Rewrite",
    description: "Preview a rewrite of the selection or current item",
  },
  {
    id: "title",
    label: "Title",
    description: "Suggest a title from the current item",
  },
  {
    id: "tags",
    label: "Tags",
    description: "Suggest tags from the current item",
  },
  {
    id: "excerpt",
    label: "Excerpt",
    description: "Preview an excerpt from the current item",
  },
] as const;

export type NativeQuickActionId = (typeof NATIVE_QUICK_ACTIONS)[number]["id"];
export type NativeQuickActionField = WorkspaceItemTextField;
export type NativeQuickActionScope = "field" | "selection";

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
      source: string;
      result: string;
      range: WorkspaceItemTextEdit["range"];
      scope: NativeQuickActionScope;
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

function proposalFromEdit({
  canApply,
  edit,
  label,
  note,
  scope,
}: {
  canApply: boolean;
  edit: WorkspaceItemTextEdit;
  label: string;
  note?: string;
  scope: NativeQuickActionScope;
}): NativeQuickActionResult {
  return {
    kind: "proposal",
    field: edit.field,
    label,
    before: edit.before,
    after: edit.after,
    source: edit.source,
    result: edit.result,
    range: edit.range,
    scope,
    canApply,
    note,
  };
}

function wholeFieldEdit(
  field: WorkspaceItemTextField,
  source: string,
  after: string,
): WorkspaceItemTextEdit {
  const edit = createWorkspaceItemTextEdit({
    after,
    end: source.length,
    field,
    source,
    start: 0,
  });
  if (!edit) throw new Error("The item changed before the preview was ready.");
  return edit;
}

function rewriteTarget(item: WorkspaceItemTextSnapshot): {
  editSource: string;
  end: number;
  field: WorkspaceItemTextField;
  source: string;
  start: number;
  scope: NativeQuickActionScope;
} {
  const selection = resolveWorkspaceItemTextSelection(item);
  if (selection) {
    return {
      editSource: item[selection.field],
      end: selection.end,
      field: selection.field,
      source: selection.text,
      start: selection.start,
      scope: "selection",
    };
  }

  for (const field of ["body", "excerpt", "title"] as const) {
    if (!item[field].trim()) continue;
    return {
      editSource: item[field],
      end: item[field].length,
      field,
      source: item[field],
      start: 0,
      scope: "field",
    };
  }
  throw new Error("Add some text before rewriting.");
}

export async function runNativeQuickAction(
  action: NativeQuickActionId,
  item: WorkspaceItemTextSnapshot,
): Promise<NativeQuickActionResult> {
  const source = requireSource(item);

  switch (action) {
    case "summarize": {
      const selection = resolveWorkspaceItemTextSelection(item);
      const result = await nativeSummarize(selection?.text ?? source);
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
      const title = result.title.trim();
      return proposalFromEdit({
        edit: wholeFieldEdit("title", item.title, title),
        label: "Suggested title",
        canApply: Boolean(title) && !result.truncated,
        scope: "field",
        note: result.truncated
          ? "The source was too long to create a complete title safely."
          : undefined,
      });
    }

    case "excerpt": {
      const result = await nativeExcerpt(source);
      const excerpt = result.excerpt.trim();
      return proposalFromEdit({
        edit: wholeFieldEdit("excerpt", item.excerpt, excerpt),
        label: "Suggested excerpt",
        canApply: Boolean(excerpt) && !result.truncated,
        scope: "field",
        note: result.truncated
          ? "The source was too long to create a complete excerpt safely."
          : undefined,
      });
    }

    case "rewrite": {
      const target = rewriteTarget(item);
      const result = await nativeRewrite(
        target.source,
        "Clear and concise. Preserve the meaning and Markdown structure.",
      );
      const rewritten = result.text.trim();
      const edit = createWorkspaceItemTextEdit({
        after: rewritten,
        end: target.end,
        field: target.field,
        source: target.editSource,
        start: target.start,
      });
      if (!edit) throw new Error("The selection is no longer available.");
      return proposalFromEdit({
        edit,
        label:
          target.scope === "selection"
            ? "Rewritten selection"
            : `Rewritten ${target.field}`,
        canApply: Boolean(rewritten) && !result.truncated,
        scope: target.scope,
        note: result.truncated
          ? "The text was too long to rewrite safely. The preview cannot be applied."
          : undefined,
      });
    }
  }
}
