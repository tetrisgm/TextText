"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ItemTypeBlueprint } from "@/lib/presentation/item-type-blueprint";
import type { StudioTimeline } from "../item-type-studio-state";
import type {
  AssistantAttachment,
  AssistantWorkspaceContextItem,
} from "./AssistantSidebar";

type AssistantComposerDraft = {
  attachments: readonly AssistantAttachment[];
  text: string;
  customization?: AssistantCustomizationDraft;
};

/** A customization is an unsent assistant draft. Keep it in the existing
 * composer store, scoped by the opaque owner key and the original target. */
export type AssistantCustomizationDraft = {
  version: 1;
  workspaceId: string;
  targetPostId?: string;
  expectedRevision?: number;
  initialTemplate?: { id: string; version: number };
  editing?: { templateId: string; baseVersion: number; blueprint: ItemTypeBlueprint };
  prompt: string;
  followUp: string;
  timeline: StudioTimeline;
  folderPath: string;
  targetScope: "item" | "folder" | "existing";
  saveMode: "version" | "folder" | "usages";
  applyToExisting: boolean;
  pendingItemLook: { id: string; version: number } | null;
  saveRequestId?: string;
  saveIntent?: AssistantCustomizationSaveIntent;
};

/** Bind recovery to the exact preview and audience the user chose to save. */
export type AssistantCustomizationSaveIntent = Pick<AssistantCustomizationDraft,
  "editing" | "folderPath" | "targetScope" | "saveMode" | "applyToExisting"
> & { blueprint: ItemTypeBlueprint };

function cleanCustomization(value: unknown): AssistantCustomizationDraft | undefined {
  if (!value || typeof value !== "object") return;
  const draft = value as AssistantCustomizationDraft;
  if (draft.version !== 1 || typeof draft.workspaceId !== "string" ||
      typeof draft.prompt !== "string" || typeof draft.followUp !== "string" ||
      typeof draft.folderPath !== "string" ||
      !["item", "folder", "existing"].includes(draft.targetScope) ||
      !["version", "folder", "usages"].includes(draft.saveMode) ||
      !Array.isArray(draft.timeline?.revisions) || draft.timeline.revisions.length > 30 ||
      !Number.isInteger(draft.timeline.index) || !Number.isInteger(draft.timeline.nextId) ||
      (draft.expectedRevision !== undefined && (!Number.isInteger(draft.expectedRevision) || draft.expectedRevision < 0)) ||
      (draft.targetPostId !== undefined && typeof draft.targetPostId !== "string")) return;
  // The lazy studio validates blueprint data on restoration. Keeping that
  // compiler out of the ordinary composer avoids loading it for non-AI use.
  return { ...draft, prompt: draft.prompt.slice(0, 6000), followUp: draft.followUp.slice(0, 6000),
    timeline: { ...draft.timeline, index: Math.max(-1, Math.min(draft.timeline.index, draft.timeline.revisions.length - 1)) },
  };
}

const EMPTY_DRAFT: AssistantComposerDraft = { attachments: [], text: "" };
const drafts = new Map<string, AssistantComposerDraft>();
const listeners = new Set<() => void>();
let attachmentCounter = 0;
const CUSTOMIZATION_STORAGE_LIMIT = 20;
const CUSTOMIZATION_BYTE_LIMIT = 2_000_000;

function persistCustomization(contextKey: string, customization: AssistantCustomizationDraft | undefined) {
  const storage = window.localStorage;
  if (!storage) return;
  const key = storageKey(contextKey);
  if (!customization) { storage.removeItem(key); return; }
  const encoded = JSON.stringify(customization);
  if (encoded.length >= CUSTOMIZATION_BYTE_LIMIT) { storage.removeItem(key); return; }
  // Bound retained target drafts, always preserving the one being edited.
  storage.removeItem(key);
  storage.setItem(key, encoded);
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((value): value is string => Boolean(value?.startsWith("texttext:assistant-composer:") && value.includes(":customize:")));
  for (const oldest of keys.filter((entry) => entry !== key).slice(0, Math.max(0, keys.length - CUSTOMIZATION_STORAGE_LIMIT))) {
    storage.removeItem(oldest);
    const oldContextKey = oldest.slice("texttext:assistant-composer:".length);
    const previous = drafts.get(oldContextKey);
    if (previous) drafts.set(oldContextKey, { ...previous, customization: undefined });
  }
}

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
  let customization: AssistantCustomizationDraft | undefined;
  try {
    text = window.sessionStorage.getItem(storageKey(contextKey)) ?? "";
    const persisted = window.localStorage?.getItem(storageKey(contextKey));
    if (persisted && persisted.length < CUSTOMIZATION_BYTE_LIMIT) customization = cleanCustomization(JSON.parse(persisted));
  } catch {
    // The in-memory draft remains available when storage is unavailable.
  }
  const restored = text || customization ? { attachments: [], text, ...(customization ? { customization } : {}) } : EMPTY_DRAFT;
  drafts.set(contextKey, restored);
  return restored;
}

function writeDraft(contextKey: string, draft: AssistantComposerDraft) {
  drafts.set(contextKey, draft);
  // Enforce the memory bound before touching browser storage: either storage
  // API may throw when disabled or full, while the current draft still works.
  const customizationKeys = [...drafts].filter(([, entry]) => entry.customization).map(([key]) => key);
  const evictedKeys = customizationKeys.filter((key) => key !== contextKey)
    .slice(0, Math.max(0, customizationKeys.length - CUSTOMIZATION_STORAGE_LIMIT));
  for (const key of evictedKeys) {
    const previous = drafts.get(key)!;
    drafts.set(key, { ...previous, customization: undefined });
    try { window.localStorage?.removeItem(storageKey(key)); } catch { /* Storage is optional. */ }
  }
  try {
    if (draft.text) {
      window.sessionStorage.setItem(storageKey(contextKey), draft.text);
    } else {
      window.sessionStorage.removeItem(storageKey(contextKey));
    }
    persistCustomization(contextKey, draft.customization);
  } catch {
    // The in-memory draft remains authoritative for this app session.
  }
  notify();
}

export function saveAssistantCustomizationDraft(contextKey: string, customization: AssistantCustomizationDraft | undefined) {
  const current = readAssistantComposerDraft(contextKey);
  writeDraft(contextKey, { ...current, customization });
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
