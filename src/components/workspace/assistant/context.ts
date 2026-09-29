import type { WorkspacePoolPayload } from "@/lib/pool/types";
import {
  resolveWorkspaceItemTextSelection,
  type WorkspaceItemTextSelection,
  type WorkspaceItemTextSnapshot,
} from "@/lib/ai/workspace-item-draft";
import { findPoolPostById, folderPathForPoolPost } from "@/lib/pool/selectors";

type AssistantContextKind = "workspace" | "folder" | "item";

export type AssistantContext = {
  label: string;
  detail?: string;
  kind?: AssistantContextKind;
  templateId?: string;
};

export type AssistantViewSnapshot = {
  level?: string;
  folderPath?: string;
  postId?: string;
};

type AssistantWorkspaceView =
  | { level: "root" }
  | { folderPath: string; level: "section" | "trash" | "shared" | "starred" }
  | { folderPath: string; level: "post" | "edit"; postId: string };

type ResolvedAssistantContext = {
  chip: AssistantContext;
  contextKey: string;
  view: AssistantViewSnapshot;
};

const FIELD_LABELS = {
  title: "title",
  excerpt: "excerpt",
  body: "body",
} as const;

const MAX_ASSISTANT_ITEM_BODY_CHARS = 6_000;

/** A title or excerpt caret is not selected text. Only a body caret has a
 * supported insertion envelope; keep it for requests such as "write here". */
export function assistantComposerSelection(
  item: WorkspaceItemTextSnapshot | null,
): WorkspaceItemTextSelection | null {
  if (!item) return null;
  const selection = item.selection ?? item.writingSelection;
  if (!selection || (!selection.text && selection.field !== "body")) return null;
  return resolveWorkspaceItemTextSelection({ ...item, selection });
}

export function assistantContextChipWithSelection(
  chip: AssistantContext,
  selection: WorkspaceItemTextSelection | null,
): AssistantContext {
  if (!selection) return chip;
  return {
    ...chip,
    detail: selection.text ? `Selected ${FIELD_LABELS[selection.field]} text` : "Caret in body",
  };
}

export function appendAssistantSelectionContext(
  context: string,
  item: WorkspaceItemTextSnapshot,
): string {
  const itemContext = [
    context,
    "Current item content:",
    `Title: ${JSON.stringify(item.title)}`,
    `Excerpt: ${JSON.stringify(item.excerpt)}`,
    `Body: ${JSON.stringify(item.body.slice(0, MAX_ASSISTANT_ITEM_BODY_CHARS))}`,
    item.body.length > MAX_ASSISTANT_ITEM_BODY_CHARS
      ? `The body was truncated after ${MAX_ASSISTANT_ITEM_BODY_CHARS} characters. Use read_item before replacing the whole body.`
      : "The full current item is included above.",
  ].join("\n");
  const selection = assistantComposerSelection(item);
  if (!selection) {
    return `${itemContext}\nNo editor text is selected; use the whole current item when appropriate.`;
  }
  if (!selection.text) {
    return `${itemContext}\nThe writing caret is in the body at source offset ${selection.start}. No text is selected.`;
  }
  return [
    itemContext,
    `The user selected ${selection.field} text at source range [${selection.start}, ${selection.end}).`,
    `Selected text: ${JSON.stringify(selection.text)}`,
    "Treat that exact range as the active editing context. Do not imply that unselected text is selected.",
  ].join("\n");
}

function folderPlaceKey(homePath: string, folderPath: string): string {
  return `place:${homePath}?folder=${encodeURIComponent(folderPath)}`;
}

export function resolveWorkspaceAssistantContext({
  homePath,
  pool,
  selectedFolderPath,
  selectedPostId,
  view,
}: {
  homePath: string;
  pool: WorkspacePoolPayload;
  selectedFolderPath: string | null;
  selectedPostId: string | null;
  view: AssistantWorkspaceView;
}): ResolvedAssistantContext {
  const itemId =
    view.level === "post" || view.level === "edit"
      ? view.postId
      : view.level === "section" || view.level === "starred"
        ? selectedPostId
        : null;
  const item = itemId ? findPoolPostById(pool, itemId) : null;

  if (item) {
    const folderPath = folderPathForPoolPost(pool, item);
    return {
      chip: {
        kind: "item",
        label: item.title.trim() || "Untitled",
        templateId:
          item.document?.presentation.template.id ?? item.template?.id,
        detail:
          view.level === "edit"
            ? "Editing"
            : view.level === "section" || view.level === "starred"
              ? "Selected item"
              : "Item",
      },
      contextKey: `item:${item.id}`,
      view: {
        level: view.level === "edit" ? "edit" : "post",
        folderPath,
        postId: item.id,
      },
    };
  }

  const folderPath =
    view.level === "root"
      ? selectedFolderPath
      : view.level === "section"
        ? view.folderPath
        : null;
  const folder = folderPath
    ? pool.folders.find((candidate) => candidate.path === folderPath)
    : null;

  if (folder) {
    return {
      chip: { kind: "folder", label: folder.name, detail: "Folder" },
      contextKey: folderPlaceKey(homePath, folder.path),
      view: { level: "section", folderPath: folder.path },
    };
  }

  if (
    view.level === "trash" ||
    view.level === "shared" ||
    view.level === "starred"
  ) {
    const label =
      view.level === "trash"
        ? "Trash"
        : view.level === "shared"
          ? "Shared with me"
          : "Starred";
    return {
      chip: { kind: "folder", label },
      contextKey: folderPlaceKey(homePath, view.folderPath),
      view: { level: view.level, folderPath: view.folderPath },
    };
  }

  return {
    chip: {
      kind: "workspace",
      label: pool.blog.name,
      detail: "Workspace",
    },
    contextKey: `place:${homePath}`,
    view: { level: "root" },
  };
}
