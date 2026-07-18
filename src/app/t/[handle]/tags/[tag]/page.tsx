import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TagListing } from "@/components/TagListing";
import { blogFeedAlternateTypes } from "@/lib/feed-links";
import { blogTagPath } from "@/lib/public-paths";
import { getBlog, getPostsForTag } from "@/lib/store";
import { normalizeTag } from "@/lib/tags";

interface Props {
  params: Promise<{ handle: string; tag: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, tag: rawTag } = await params;
  const blog = await getBlog(handle);
  const tag = normalizeTag(rawTag);
  if (!blog || !tag) return {};
  return {
    title: `#${tag} · ${blog.name}`,
    description: `Published posts tagged #${tag}.`,
    alternates: {
      canonical: blogTagPath(blog, tag),
      types: blogFeedAlternateTypes(blog, blog.name),
    },
  };
}

export async function TagPageForHandle({
  handle,
  rawTag,
  redirectClaimed = true,
}: {
  handle: string;
  rawTag: string;
  redirectClaimed?: boolean;
}) {
  const blog = await getBlog(handle);
  const tag = normalizeTag(rawTag);
  if (!blog || !tag) notFound();
  if (redirectClaimed && blog.username) redirect(blogTagPath(blog, tag));
  const posts = await getPostsForTag(handle, tag, { publishedOnly: true });
  return <TagListing blog={blog} handle={handle} posts={posts} tag={tag} />;
}

export default async function TenantTagPage({ params }: Props) {
  const { handle, tag } = await params;
  return <TagPageForHandle handle={handle} rawTag={tag} />;
}
