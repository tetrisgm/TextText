import { notFound } from "next/navigation";
import { EditorApp } from "@/components/editor/EditorApp";
import { SignInScreen } from "@/components/editor/SignInScreen";
import { isAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/lib/session";
import { ensureOwnerBlog, getAllPosts, getBlog } from "@/lib/store";

export default async function EditorPage() {
  const dbEnabled = !!process.env.DATABASE_URL;
  const mediaEnabled = !!process.env.BLOB_READ_WRITE_TOKEN;

  // Auth off: zero-setup demo mode, the whole app runs with no configuration.
  if (!isAuthConfigured) {
    const [blog, posts] = await Promise.all([
      getBlog("demo"),
      getAllPosts("demo"),
    ]);
    if (!blog) notFound();
    return (
      <EditorApp
        blog={blog}
        posts={posts}
        dbEnabled={dbEnabled}
        mediaEnabled={mediaEnabled}
      />
    );
  }

  // Auth on: the editor is gated to the signed-in user and their own blog.
  const user = await getCurrentUser();
  if (!user) return <SignInScreen />;

  const blog = await ensureOwnerBlog(user);
  const posts = await getAllPosts(blog.handle);
  return (
    <EditorApp
      blog={blog}
      posts={posts}
      dbEnabled={dbEnabled}
      mediaEnabled={mediaEnabled}
    />
  );
}
