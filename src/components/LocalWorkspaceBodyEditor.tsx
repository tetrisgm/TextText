"use client";

import { BodyEditor } from "@/components/BodyEditor";

export type LocalWorkspaceBodyEditorProps = {
  value: string;
  onChange: (value: string) => void;
  mediaEnabled?: boolean;
  uploadEndpoint?: string;
  onNavigateField?: (direction: "previous" | "next") => void;
};

export function LocalWorkspaceBodyEditor(props: LocalWorkspaceBodyEditorProps) {
  return <BodyEditor {...props} />;
}
