"use client";

import { useRouter } from "next/navigation";
import { saveItemAsLookAction } from "@/app/editor/look-actions";
import type { Blog, Post } from "@/lib/content";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import {
  UnifiedDocumentEditor,
  type UnifiedEditorCollab,
} from "./UnifiedDocumentEditor";

export function StandaloneUnifiedDocumentEditor({
  blog,
  collab,
  post,
  postPath,
  template,
}: {
  blog: Blog;
  collab: UnifiedEditorCollab;
  post: Post;
  postPath: string;
  template: TemplateDefinition;
}) {
  const router = useRouter();
  return (
    <UnifiedDocumentEditor
      blog={blog}
      collab={collab}
      post={post}
      template={template}
      onSaveAsLook={async (name) => {
        if (!post.id) return { ok: false, message: "Save the item first." };
        const result = await saveItemAsLookAction(blog.handle, post.id, name);
        return result.ok
          ? { ok: true, message: `Saved as "${result.name}"` }
          : { ok: false, message: result.error };
      }}
      onDone={() => router.replace(postPath)}
    />
  );
}
