import { notFound } from "next/navigation";
import { EditorApp } from "@/components/editor/EditorApp";
import { getAllPosts, getBlog } from "@/lib/store";

export default async function EditorPage() {
  const [blog, posts] = await Promise.all([
    getBlog("demo"),
    getAllPosts("demo"),
  ]);
  if (!blog) notFound();

  return <EditorApp blog={blog} posts={posts} />;
}
