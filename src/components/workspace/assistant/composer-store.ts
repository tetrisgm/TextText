"use client";

import { useCallback, useSyncExternalStore } from "react";
import type {
  AssistantAttachment,
  AssistantWorkspaceContextItem,
} from "./AssistantSidebar";

export type AssistantComposerDraft = {
  attachments: readonly AssistantAttachment[];
  text: string;
};

const EMPTY_DRAFT: AssistantComposerDraft = { attachments: [], text: "" };
const drafts = new Map<string, AssistantComposerDraft>();
const listeners = new Set<() => void>();
let attachmentCounter = 0;

function storageKey(contextKey: string): string {
  return `texttext:assistant-composer:${contextKey}`;
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readAssistantComposerDraft(
  contextKey: string,
): AssistantComposerDraft {
  const current = drafts.get(contextKey);
  if (current) return current;

  let text = "";
  try {
    text = window.sessionStorage.getItem(storageKey(contextKey)) ?? "";
  } catch {
    // The in-memory draft remains available when storage is unavailable.
  }
  const restored = text ? { attachments: [], text } : EMPTY_DRAFT;
  drafts.set(contextKey, restored);
  return restored;
}

function writeDraft(contextKey: string, draft: AssistantComposerDraft) {
  drafts.set(contextKey, draft);
  try {
    if (draft.text) {
      window.sessionStorage.setItem(storageKey(contextKey), draft.text);
    } else {
      window.sessionStorage.removeItem(storageKey(contextKey));
    }
  } catch {
    // The in-memory draft remains authoritative for this app session.
  }
  notify();
}

export function useAssistantComposerDraft(contextKey: string) {
  const draft = useSyncExternalStore(
    subscribe,
    () => readAssistantComposerDraft(contextKey),
    () => EMPTY_DRAFT,
  );

  const setText = useCallback(
    (text: string) => {
      const current = readAssistantComposerDraft(contextKey);
      writeDraft(contextKey, { ...current, text });
    },
    [contextKey],
  );

  const addFiles = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      const current = readAssistantComposerDraft(contextKey);
      const attachments = files.map((file): AssistantAttachment => {
        attachmentCounter += 1;
        return {
          id: `${file.name}:${file.size}:${file.lastModified}:${attachmentCounter}`,
          file,
          name: file.name,
          size: file.size,
          type: file.type,
        };
      });
      writeDraft(contextKey, {
        ...current,
        attachments: [...current.attachments, ...attachments],
      });
    },
    [contextKey],
  );

  const addContextItem = useCallback(
    (item: AssistantWorkspaceContextItem) => {
      const current = readAssistantComposerDraft(contextKey);
      if (
        current.attachments.filter((attachment) => attachment.workspaceItemId)
          .length >= 4
      ) {
        return;
      }
      if (
        current.attachments.some(
          (attachment) => attachment.workspaceItemId === item.id,
        )
      ) {
        return;
      }
      attachmentCounter += 1;
      writeDraft(contextKey, {
        ...current,
        attachments: [
          ...current.attachments,
          {
            id: `workspace:${item.id}:${attachmentCounter}`,
            name: item.name,
            detail: item.detail,
            type: "application/x-texttext-item",
            workspaceItemId: item.id,
          },
        ],
      });
    },
    [contextKey],
  );

  const removeAttachment = useCallback(
    (attachmentId: string) => {
      const current = readAssistantComposerDraft(contextKey);
      writeDraft(contextKey, {
        ...current,
        attachments: current.attachments.filter(
          (attachment) => attachment.id !== attachmentId,
        ),
      });
    },
    [contextKey],
  );

  const clear = useCallback(() => {
    writeDraft(contextKey, EMPTY_DRAFT);
  }, [contextKey]);

  return {
    addContextItem,
    addFiles,
    clear,
    draft,
    removeAttachment,
    setText,
  };
}

export function resetAssistantComposerDraftsForTests() {
  drafts.clear();
  attachmentCounter = 0;
  notify();
}
