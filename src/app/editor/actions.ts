"use server";

import type { Blog, Post, PostType } from "@/lib/content";
import { isAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/lib/session";
import type { BlogPatch } from "@/lib/store";
import { createDraft, ensureOwnerBlog, savePost, updateBlog } from "@/lib/store";

// The blog the editor writes to, resolved from the session on the SERVER so a
// client can never target another user's blog. Writing always requires auth;
// demo mode (auth off) is read only, so these actions refuse there.
async function editorUser() {
  if (!isAuthConfigured) throw new Error("Editing requires signing in");
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  return user;
}

async function editorHandle(): Promise<string> {
  const user = await editorUser();
  const blog = await ensureOwnerBlog(user);
  return blog.handle;
}

export async function savePostAction(post: Post): Promise<Post> {
  return savePost(await editorHandle(), post);
}

export async function createDraftAction(type: PostType = "article"): Promise<Post> {
  return createDraft(await editorHandle(), type);
}

export async function updateBlogAction(patch: BlogPatch): Promise<Blog> {
  const user = await editorUser();
  return updateBlog(user.sub, patch);
}
