"use client";

import type {
  WorkspaceItemTextEdit,
  WorkspaceItemTextField,
} from "@/lib/ai/workspace-item-draft";

export const NATIVE_QUICK_ACTIONS = [
  {
    id: "summarize",
    label: "Summarize",
    description: "Summarize the selection or current item",
  },
  {
    id: "rewrite",
    label: "Rewrite",
    description: "Preview a rewrite of the selection or current item",
  },
  {
    id: "structure",
    label: "Structure",
    description: "Preview a clearer structure for the current item",
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
    }
  | {
      kind: "tags-proposal";
      label: string;
      beforeTags: string[];
      afterTags: string[];
      addedTags: string[];
      canApply: boolean;
      note?: string;
    };
