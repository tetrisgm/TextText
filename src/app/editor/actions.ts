"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Blog, Post, PostType } from "@/lib/content";
import { isAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/lib/session";
import type { BlogPatch } from "@/lib/store";
import {
  createDraft,
  deletePost,
  ensureOwnerBlog,
  getPostById,
  savePost,
  updateBlog,
} from "@/lib/store";

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

const POST_TYPES: PostType[] = ["article", "project", "talk"];
const BLOG_FEED_PATHS = [
  "posts.json",
  "feed.json",
  "feed.xml",
  "atom.xml",
  "sitemap.xml",
  "llms.txt",
];

function cleanPostType(value: unknown): PostType {
  return POST_TYPES.includes(value as PostType) ? (value as PostType) : "article";
}

function cleanPostId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Post not found");
  }
  return value.trim();
}

function cleanStatus(value: unknown): Post["status"] {
  if (value === "published" || value === "draft") return value;
  throw new Error("Visibility must be Public or Unlisted");
}

function cleanLine(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function cleanBody(value: unknown): string {
  if (typeof value !== "string") throw new Error("Body must be text");
  return value.replace(/\u0000/g, "");
}

function cleanAccent(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw new Error("Accent must be a hex color");
  const accent = value.trim();
  if (!accent) return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) {
    throw new Error("Accent must be a hex color like #065ec6");
  }
  return accent;
}

function cleanSlug(value: unknown, fallback: string): string {
  if (typeof value !== "string") throw new Error("Slug must be text");
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function editableInput(input: unknown, fallbackSlug: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid post");
  }
  const values = input as Record<string, unknown>;
  return {
    id: cleanPostId(values.id),
    title: cleanLine(values.title, "Title"),
    kicker: cleanLine(values.kicker ?? "", "Kicker") || undefined,
    body: cleanBody(values.body),
    status: cleanStatus(values.status),
    slug: cleanSlug(values.slug, fallbackSlug),
    accent: cleanAccent(values.accent),
  };
}

function blogPath(handle: string, path = ""): string {
  return `/t/${encodeURIComponent(handle)}${path}`;
}

function revalidateBlog(handle: string, slugs: string[] = []) {
  revalidatePath(blogPath(handle));
  for (const feedPath of BLOG_FEED_PATHS) {
    revalidatePath(blogPath(handle, `/${feedPath}`));
  }
  for (const slug of new Set(slugs.filter(Boolean))) {
    revalidatePath(blogPath(handle, `/${encodeURIComponent(slug)}`));
    revalidatePath(blogPath(handle, `/${encodeURIComponent(slug)}/index.md`));
  }
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

export async function createPostAndRedirectAction(formData: FormData) {
  const handle = await editorHandle();
  const post = await createDraft(handle, cleanPostType(formData.get("type")));
  revalidateBlog(handle, [post.slug]);
  redirect(blogPath(handle, `/${encodeURIComponent(post.slug)}?edit=1`));
}

export async function saveEditablePostAction(input: unknown): Promise<Post> {
  const handle = await editorHandle();
  const id = cleanPostId(
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>).id
      : undefined,
  );
  const existing = await getPostById(handle, id);
  if (!existing) throw new Error("Post not found");

  const patch = editableInput(input, existing.slug);
  const saved = await savePost(handle, {
    ...existing,
    title: patch.title,
    kicker: patch.kicker,
    body: patch.body,
    status: patch.status,
    slug: patch.slug,
    accent: patch.accent,
  });
  revalidateBlog(handle, [existing.slug, saved.slug]);
  return saved;
}

export async function deleteEditablePostAction(
  id: unknown,
): Promise<{ handle: string }> {
  const handle = await editorHandle();
  const postId = cleanPostId(id);
  const existing = await getPostById(handle, postId);
  if (!existing) throw new Error("Post not found");
  await deletePost(handle, postId);
  revalidateBlog(handle, [existing.slug]);
  return { handle };
}
