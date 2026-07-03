import { notFound } from "next/navigation";
import { EditorApp } from "@/components/editor/EditorApp";
import { SignInScreen } from "@/components/editor/SignInScreen";
import { isAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/lib/session";
import { ensureOwnerBlog, getAllPosts, getBlog } from "@/lib/store";

export default async function EditorPage() {
  const dbEnabled = !!process.env.DATABASE_URL;
  // Media needs a token, a database, and auth (uploads are per signed-in owner).
  const mediaEnabled =
    dbEnabled && isAuthConfigured && !!process.env.BLOB_READ_WRITE_TOKEN;

  // Auth off: zero-setup demo mode, the whole app runs with no configuration.
  if (!isAuthConfigured) {
    const [blog, posts] = await Promise.all([
      getBlog("demo"),
      getAllPosts("demo"),
    ]);
    if (!blog) notFound();
    // Read only: the demo blog is explorable without signing in, but writing
    // (Save, uploads) requires auth, so a database present without auth stays
    // safe rather than exposing an open, world-writable editor.
    return (
      <EditorApp
        blog={blog}
        posts={posts}
        dbEnabled={false}
        mediaEnabled={false}
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
