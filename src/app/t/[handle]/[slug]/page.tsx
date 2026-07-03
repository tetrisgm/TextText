import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBlog, getPost } from "@/lib/store";
import { Reader } from "@/components/Reader";
import { TalkReader } from "@/components/TalkReader";

interface Props {
  params: Promise<{ handle: string; slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, slug } = await params;
  const [blog, post] = await Promise.all([
    getBlog(handle),
    getPost(handle, slug),
  ]);
  if (!blog || !post) return {};
  return {
    title: `${post.title} · ${blog.name}`,
    description: post.body.split(/\n{2,}/)[0]?.slice(0, 160),
  };
}

export default async function PostPage({ params }: Props) {
  const { handle, slug } = await params;
  const [blog, post] = await Promise.all([
    getBlog(handle),
    getPost(handle, slug),
  ]);
  if (!blog || !post) notFound();

  const ReaderComponent = post.type === "talk" ? TalkReader : Reader;

  return <ReaderComponent blog={blog} post={post} />;
}
