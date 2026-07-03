"use server";

import type { Post } from "@/lib/content";
import { createDraft, savePost } from "@/lib/store";

// The editor operates on the demo blog today. When auth lands this resolves to
// the signed-in user's blog handle instead.
const EDITOR_HANDLE = "demo"; // TODO(auth): use the signed-in user's blog

export async function savePostAction(post: Post): Promise<Post> {
  return savePost(EDITOR_HANDLE, post);
}

export async function createDraftAction(): Promise<Post> {
  return createDraft(EDITOR_HANDLE);
}
