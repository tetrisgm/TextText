"use client";

import { BodyEditor } from "@/components/BodyEditor";

export type LocalWorkspaceBodyEditorProps = {
  value: string;
  onChange: (value: string) => void;
  toolbarHost?: HTMLElement | null;
  postType?: "article" | "project" | "talk" | "note" | "bookmark";
  mediaEnabled?: boolean;
  uploadEndpoint?: string;
  onNavigateField?: (direction: "previous" | "next") => void;
};

export function LocalWorkspaceBodyEditor(props: LocalWorkspaceBodyEditorProps) {
  return <BodyEditor {...props} />;
}
