"use client";

import { useRouter } from "next/navigation";
import type { Blog, Post } from "@/lib/content";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import {
  UnifiedDocumentEditor,
  type UnifiedEditorCollab,
} from "./UnifiedDocumentEditor";

export function StandaloneUnifiedDocumentEditor({
  blog,
  canReviewAgentChanges = false,
  collab,
  post,
  postPath,
  template,
}: {
  blog: Blog;
  canReviewAgentChanges?: boolean;
  collab: UnifiedEditorCollab;
  post: Post;
  postPath: string;
  template: TemplateDefinition;
}) {
  const router = useRouter();
  return (
    <UnifiedDocumentEditor
      blog={blog}
      canReviewAgentChanges={canReviewAgentChanges}
      collab={collab}
      post={post}
      template={template}
      onDone={() => router.replace(postPath)}
    />
  );
}
