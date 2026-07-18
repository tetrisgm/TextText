"use client";

import { BodyEditor } from "@/components/BodyEditor";
import type {
  WikiLinkCreatedPost,
  WikiLinkSuggestionPost,
} from "@/components/editor/WikiLinkCommand";

export type LocalWorkspaceBodyEditorProps = {
  value: string;
  onChange: (value: string) => void;
  mediaEnabled?: boolean;
  uploadEndpoint?: string;
  onNavigateField?: (direction: "previous" | "next") => void;
  wikiLinkPosts?: WikiLinkSuggestionPost[];
  onCreateWikiLinkNote?: (
    title: string,
  ) => Promise<WikiLinkCreatedPost | null>;
};

export function LocalWorkspaceBodyEditor(props: LocalWorkspaceBodyEditorProps) {
  return <BodyEditor {...props} />;
}
