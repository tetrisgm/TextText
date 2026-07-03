"use server";

import type { Post } from "@/lib/content";
import { isAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/lib/session";
import { createDraft, ensureOwnerBlog, savePost } from "@/lib/store";

// The blog the editor writes to, resolved from the session on the SERVER so a
// client can never target another user's blog. Auth off: the demo blog.
async function editorHandle(): Promise<string> {
  if (!isAuthConfigured) return "demo";
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  const blog = await ensureOwnerBlog(user);
  return blog.handle;
}

export async function savePostAction(post: Post): Promise<Post> {
  return savePost(await editorHandle(), post);
}

export async function createDraftAction(): Promise<Post> {
  return createDraft(await editorHandle());
}
