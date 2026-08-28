"use client";

import type {
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
